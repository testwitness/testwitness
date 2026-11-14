/**
 * C rules: what the configuration lets through. C001 test selection narrowed, C002 coverage threshold lowered or
 * removed, C003 passing with no tests enabled. Every config file is read as text from git (base and head) and
 * parsed with a real parser for its format, or with the literal reader in config-text.ts for JavaScript and
 * TypeScript configs. Nothing is executed.
 */
import { trimEndChars } from '../linear.js';
import picomatch from 'picomatch';
import type { ChangedFile, Finding, Rule, RuleContext } from '../types.js';
import {
  baseName,
  blockBodies,
  dirName,
  isOpaqueLit,
  isPlainObject,
  isRegexLit,
  jsValuesForKey,
  lineOf,
  parseIni,
  parseProperties,
  parseTomlSafe,
  nestsTooDeep,
  CONFIG_MAX_NESTING,
  parseXml,
  parseYamlOrJson,
  shellWords,
  stripJsComments,
  xmlAll,
  xmlChild,
  xmlText,
  type XmlNode,
} from '../config-text.js';
import { isCommandFile } from './W.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

// ---------------------------------------------------------------------------------------------------------------
// File routing

const JEST_JS = /^jest\.config\.(js|cjs|mjs|ts|cts|mts)$/;
const VITEST = /^(vitest\.config|vite\.config|vitest\.workspace)\.(js|cjs|mjs|ts|cts|mts)$/;
const PLAYWRIGHT = /^playwright\.config\.(js|cjs|mjs|ts|cts|mts)$/;
const MOCHARC = /^\.mocharc\.(js|cjs|yml|yaml|json|jsonc)$/;
const NYCRC = /^\.nycrc(\.(json|ya?ml))?$/;
const GRADLE = /^build\.gradle(\.kts)?$/;
const CODECOV = /^\.?codecov\.ya?ml$/;
const TESTNG = /^testng.*\.xml$/;

function isJsFile(name: string): boolean {
  return /\.(js|cjs|mjs|ts|cts|mts)$/.test(name);
}

/** Read base and head text of a changed file. */
/** Config text read at most per side of a changed file. Real runner and coverage configs are a few KB. */
export const CONFIG_TEXT_MAX_BYTES = 1024 * 1024;

/**
 * Base and head text of a changed config file. `tooLarge` when either side is over CONFIG_TEXT_MAX_BYTES: the rule then
 * reports the file at high without reading it (fail closed), because a config that large is not something a person
 * reviews and the readers are not meant to parse it.
 */
async function texts(ctx: RuleContext, f: ChangedFile): Promise<{ base: string | undefined; head: string | undefined; tooLarge: boolean; tooDeep?: boolean }> {
  const base = f.status === 'added' ? undefined : await ctx.readBase(f.oldPath ?? f.path);
  const head = f.status === 'deleted' ? undefined : await ctx.readHead(f.path);
  const tooLarge = [base, head].some((t) => t !== undefined && Buffer.byteLength(t, 'utf8') > CONFIG_TEXT_MAX_BYTES);
  if (tooLarge) return { base: undefined, head: undefined, tooLarge };
  // Nested deeper than the readers accept (config-text.ts, nestsTooDeep): also reported without being read, for the
  // same reason, and because a parser that gives up on such a file must not read as "no setting changed".
  const kind = nestedKind(f.path);
  if (kind && [base, head].some((t) => t !== undefined && nestsTooDeep(t, kind))) return { base: undefined, head: undefined, tooLarge: true, tooDeep: true };
  return { base, head, tooLarge };
}

/** How a config file nests, for the files whose readers recurse: YAML and JSON (and rc files, which are one of the two), and XML. */
function nestedKind(path: string): 'yaml-json' | 'xml' | undefined {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  if (name.endsWith('.xml')) return 'xml';
  if (/\.(ya?ml|jsonc?|json5)$/.test(name) || /^\.[\w.-]*rc$/.test(name)) return 'yaml-json';
  return undefined;
}

function tooLargeFinding(ctx: RuleContext, ruleId: 'C001' | 'C002', f: ChangedFile, what: string, tooDeep = false): Finding {
  if (tooDeep) return makeFinding(ctx, ruleId, 'high', f, 'too deep', `${f.path} changed and is nested deeper than ${CONFIG_MAX_NESTING} levels, so its ${what} could not be read; review it by hand`, { label: 'too deep' });
  return makeFinding(ctx, ruleId, 'high', f, 'too large', `${f.path} changed and is larger than ${CONFIG_TEXT_MAX_BYTES / 1048576} MB, so its ${what} could not be read; review it by hand`, { label: 'too large' });
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // Trim first: `\s*%?\s*$` on an untrimmed value backtracks quadratically on a long run of spaces.
    const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return undefined;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (isRegexLit(v)) return [v.$regex];
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' ? [x] : isRegexLit(x) ? [x.$regex] : []));
  return [];
}

function isRegexValue(v: unknown): boolean {
  return isRegexLit(v) || (Array.isArray(v) && v.some(isRegexLit));
}

// ---------------------------------------------------------------------------------------------------------------
// C002 thresholds

export interface Threshold {
  /** Unique within the file: tool and path of the setting. */
  key: string;
  /** Ecosystem and measure, for the moved control: `js:lines`, `py:total`, `jvm:line:coveredratio`, `codecov:project:target`. */
  metric: string;
  value: number;
  /** True when a higher value is weaker (an allowed drop, a maximum of missed lines). */
  inverted?: boolean;
  /** Text to find the line by. */
  needle: string;
}

const METRICS = ['lines', 'branches', 'functions', 'statements'];

/** Files C002 reads. */
export function isThresholdFile(path: string): boolean {
  const b = baseName(path);
  return (
    b === 'package.json' ||
    b === 'jest.config.json' ||
    JEST_JS.test(b) ||
    VITEST.test(b) ||
    NYCRC.test(b) ||
    ['pytest.ini', 'tox.ini', 'setup.cfg', '.coveragerc', 'pyproject.toml', 'pom.xml', '.coveralls.yml'].includes(b) ||
    GRADLE.test(b) ||
    CODECOV.test(b)
  );
}

function jestThresholds(obj: unknown, out: Threshold[]): void {
  if (!isPlainObject(obj)) return;
  for (const [scope, metrics] of Object.entries(obj)) {
    if (!isPlainObject(metrics)) continue;
    for (const [m, v] of Object.entries(metrics)) {
      const n = num(v);
      if (n === undefined) continue;
      out.push({ key: `jest.coverageThreshold.${scope}.${m}`, metric: scope === 'global' ? `js:${m}` : `js:${m}@${scope}`, value: n, needle: m });
    }
  }
}

function nycThresholds(obj: unknown, prefix: string, out: Threshold[]): void {
  if (!isPlainObject(obj)) return;
  if (obj['check-coverage'] !== true && obj['checkCoverage'] !== true) return;
  for (const m of METRICS) {
    const n = num(obj[m]);
    if (n !== undefined) out.push({ key: `${prefix}.${m}`, metric: `js:${m}`, value: n, needle: m });
  }
}

function vitestThresholds(text: string, out: Threshold[]): void {
  for (const th of jsValuesForKey(text, 'thresholds')) {
    if (!isPlainObject(th)) continue;
    for (const [k, v] of Object.entries(th)) {
      if (k === '100' && v === true) {
        for (const m of METRICS) out.push({ key: `vitest.coverage.thresholds.${m}`, metric: `js:${m}`, value: 100, needle: '100' });
        continue;
      }
      const n = num(v);
      if (n !== undefined && METRICS.includes(k)) out.push({ key: `vitest.coverage.thresholds.${k}`, metric: `js:${k}`, value: n, needle: k });
      else if (isPlainObject(v)) {
        for (const [m, mv] of Object.entries(v)) {
          const mn = num(mv);
          if (mn !== undefined && METRICS.includes(m)) out.push({ key: `vitest.coverage.thresholds.${k}.${m}`, metric: `js:${m}@${k}`, value: mn, needle: m });
        }
      }
    }
  }
  // Vitest before 1.0: coverage.lines and friends directly under coverage.
  for (const cov of jsValuesForKey(text, 'coverage')) {
    if (!isPlainObject(cov)) continue;
    for (const m of METRICS) {
      const n = num(cov[m]);
      if (n !== undefined) out.push({ key: `vitest.coverage.${m}`, metric: `js:${m}`, value: n, needle: m });
    }
  }
}

function covFailUnder(addopts: unknown, out: Threshold[]): void {
  const words = Array.isArray(addopts) ? addopts.filter((x): x is string => typeof x === 'string').flatMap(shellWords) : typeof addopts === 'string' ? shellWords(addopts) : [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    let v: string | undefined;
    if (w.startsWith('--cov-fail-under=')) v = w.slice('--cov-fail-under='.length);
    else if (w === '--cov-fail-under') v = words[i + 1];
    const n = num(v);
    if (n !== undefined) out.push({ key: 'pytest.addopts.--cov-fail-under', metric: 'py:total', value: n, needle: '--cov-fail-under' });
  }
}

function jacocoLimitValue(raw: string, type: string): number | undefined {
  const pct = /%\s*$/.test(raw);
  const n = num(raw);
  if (n === undefined) return undefined;
  return !pct && /RATIO$/i.test(type) && n <= 1 ? Math.round(n * 10000) / 100 : n;
}

function pomThresholds(text: string, out: Threshold[]): void {
  const root = parseXml(text);
  if (!root) return;
  const seen = new Map<string, number>();
  for (const limit of xmlAll(root, 'limit')) {
    let rule: XmlNode | undefined = limit.parent;
    while (rule && rule.name !== 'rule') rule = rule.parent;
    if (!rule) continue;
    const element = xmlText(xmlChild(rule, 'element')) ?? 'BUNDLE';
    const counter = (xmlText(xmlChild(limit, 'counter')) ?? limit.attrs['counter'] ?? 'INSTRUCTION').toUpperCase();
    const type = (xmlText(xmlChild(limit, 'value')) ?? limit.attrs['value'] ?? 'COVEREDRATIO').toUpperCase();
    for (const bound of ['minimum', 'maximum'] as const) {
      const raw = xmlText(xmlChild(limit, bound)) ?? limit.attrs[bound];
      if (raw === undefined) continue;
      const value = jacocoLimitValue(raw, type);
      if (value === undefined) continue;
      const base = `jacoco.${element}.${counter}.${type}.${bound}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({ key: n ? `${base}#${n}` : base, metric: `jvm:${counter.toLowerCase()}:${type.toLowerCase()}`, value, ...(bound === 'maximum' ? { inverted: true } : {}), needle: `<${bound}>${raw}` });
    }
  }
}

function gradleThresholds(text: string, out: Threshold[]): void {
  const s = stripJsComments(text);
  let i = 0;
  for (const m of s.matchAll(/\b(min|max)Bound\s*\(\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\w.]+))?/g)) {
    const unit = (m[3]?.split('.').pop() ?? 'LINE').toUpperCase();
    out.push({ key: `kover.${m[1]}Bound.${unit}#${i++}`, metric: `jvm:${unit.toLowerCase()}:coveredratio`, value: Number(m[2]), ...(m[1] === 'max' ? { inverted: true } : {}), needle: `${m[1]}Bound` });
  }
  i = 0;
  for (const m of s.matchAll(/\b(min|max)Value\s*(?:=|\.set\()\s*(\d+(?:\.\d+)?)/g)) {
    out.push({ key: `kover.${m[1]}Value#${i++}`, metric: 'jvm:line:coveredratio', value: Number(m[2]), ...(m[1] === 'max' ? { inverted: true } : {}), needle: `${m[1]}Value` });
  }
  if (!/violationRules/.test(s)) return;
  i = 0;
  for (const { body } of blockBodies(s, /\blimit\s*\{/)) {
    const counter = (/\bcounter\s*=\s*["'](\w+)["']/.exec(body)?.[1] ?? 'INSTRUCTION').toUpperCase();
    const type = (/\bvalue\s*=\s*["'](\w+)["']/.exec(body)?.[1] ?? 'COVEREDRATIO').toUpperCase();
    for (const bound of ['minimum', 'maximum'] as const) {
      const m = new RegExp(`\\b${bound}\\s*=\\s*(?:new\\s+)?(?:(?:BigDecimal\\(|\\()\\s*)?["']?(\\d+(?:\\.\\d+)?)`).exec(body);
      if (!m) continue;
      const value = jacocoLimitValue(m[1]!, type);
      if (value === undefined) continue;
      out.push({ key: `jacoco.gradle.${counter}.${type}.${bound}#${i}`, metric: `jvm:${counter.toLowerCase()}:${type.toLowerCase()}`, value, ...(bound === 'maximum' ? { inverted: true } : {}), needle: bound });
    }
    i++;
  }
}

function codecovThresholds(doc: unknown, out: Threshold[]): void {
  if (!isPlainObject(doc) || !isPlainObject(doc['coverage']) || !isPlainObject(doc['coverage']['status'])) return;
  const status = doc['coverage']['status'];
  for (const kind of ['project', 'patch']) {
    const v = status[kind];
    if (!isPlainObject(v)) continue;
    const entries: Array<[string, unknown]> = 'target' in v || 'threshold' in v ? [['default', v]] : Object.entries(v);
    for (const [name, e] of entries) {
      if (!isPlainObject(e)) continue;
      const target = num(e['target']);
      if (target !== undefined) out.push({ key: `codecov.status.${kind}.${name}.target`, metric: `codecov:${kind}:target`, value: target, needle: 'target' });
      const threshold = num(e['threshold']);
      if (threshold !== undefined) out.push({ key: `codecov.status.${kind}.${name}.threshold`, metric: `codecov:${kind}:threshold`, value: threshold, inverted: true, needle: 'threshold' });
    }
  }
}

/** Coverage thresholds a config file sets, read as text. */
export function thresholdsOf(path: string, text: string | undefined): Threshold[] {
  if (text === undefined) return [];
  const b = baseName(path);
  const out: Threshold[] = [];
  try {
    if (b === 'package.json') {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      if (isPlainObject(pkg['jest'])) jestThresholds(pkg['jest']['coverageThreshold'], out);
      nycThresholds(pkg['nyc'], 'nyc', out);
    } else if (b === 'jest.config.json') {
      const cfg = JSON.parse(text) as Record<string, unknown>;
      jestThresholds(cfg['coverageThreshold'], out);
    } else if (JEST_JS.test(b)) {
      for (const v of jsValuesForKey(text, 'coverageThreshold')) jestThresholds(v, out);
    } else if (VITEST.test(b)) {
      vitestThresholds(text, out);
    } else if (NYCRC.test(b)) {
      nycThresholds(parseYamlOrJson(text), 'nyc', out);
    } else if (b === 'pytest.ini' || b === 'tox.ini' || b === 'setup.cfg') {
      const ini = parseIni(text);
      const pytest = b === 'setup.cfg' ? ini['tool:pytest'] : ini['pytest'];
      covFailUnder(pytest?.['addopts'], out);
      const fu = num(ini['coverage:report']?.['fail_under']);
      if (fu !== undefined) out.push({ key: 'coverage.report.fail_under', metric: 'py:total', value: fu, needle: 'fail_under' });
    } else if (b === '.coveragerc') {
      const ini = parseIni(text);
      const fu = num(ini['report']?.['fail_under'] ?? ini['coverage:report']?.['fail_under']);
      if (fu !== undefined) out.push({ key: 'coverage.report.fail_under', metric: 'py:total', value: fu, needle: 'fail_under' });
    } else if (b === 'pyproject.toml') {
      const doc = parseTomlSafe(text);
      const tool = isPlainObject(doc?.['tool']) ? doc['tool'] : {};
      const pytest = isPlainObject(tool['pytest']) ? tool['pytest'] : {};
      const opts = isPlainObject(pytest['ini_options']) ? pytest['ini_options'] : pytest;
      covFailUnder(opts['addopts'], out);
      const cov = isPlainObject(tool['coverage']) && isPlainObject(tool['coverage']['report']) ? tool['coverage']['report'] : {};
      const fu = num(cov['fail_under']);
      if (fu !== undefined) out.push({ key: 'coverage.report.fail_under', metric: 'py:total', value: fu, needle: 'fail_under' });
    } else if (b === 'pom.xml') {
      pomThresholds(text, out);
    } else if (GRADLE.test(b)) {
      gradleThresholds(text, out);
    } else if (CODECOV.test(b)) {
      codecovThresholds(parseYamlOrJson(text), out);
    } else if (b === '.coveralls.yml') {
      const doc = parseYamlOrJson(text);
      if (isPlainObject(doc)) {
        for (const [k, v] of Object.entries(doc)) {
          const n = num(v);
          if (n === undefined || !/threshold|minimum/i.test(k)) continue;
          out.push({ key: `coveralls.${k}`, metric: `coveralls:${k}`, value: n, ...(/decrease/i.test(k) ? { inverted: true } : {}), needle: k });
        }
      }
    }
  } catch {
    return [];
  }
  return out;
}

function weaker(t: Threshold, than: Threshold): boolean {
  return than.inverted ? t.value > than.value : t.value < than.value;
}

/** C002 Coverage threshold lowered or removed. */
export const C002: Rule = {
  id: 'C002',
  name: 'Coverage threshold lowered or removed',
  group: 'C',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'config'],
  docs: {
    summary:
      'A coverage gate got weaker: a threshold was lowered (medium) or removed (high). Read as config text and compared as numbers between base and head: Jest coverageThreshold (jest.config.*, package.json jest), Vitest coverage.thresholds, nyc check-coverage values (.nycrc, package.json nyc), pytest --cov-fail-under in addopts (pytest.ini, setup.cfg, tox.ini, pyproject.toml), coverage.py fail_under (.coveragerc, [coverage:report], [tool.coverage.report]), JaCoCo limits in pom.xml and Gradle violationRules, Kover minBound and minValue, codecov.yml target and threshold, and .coveralls.yml thresholds. For an allowed drop (codecov threshold, a JaCoCo maximum, a coveralls decrease threshold) a higher value is the weaker one.',
    falsePositives:
      'A threshold moved to another file in the same PR (or to another setting in the same file, such as --cov-fail-under to fail_under) with the same or a stricter value is silent. A new project with its own threshold is not a lowering, because only settings present in the base are compared. Removing an allowed drop (codecov threshold) is stricter and is not reported. Values that are not literal numbers (codecov auto, a variable) are not read. A changed config file over 1 MB is not read and is reported high with the label too large; a YAML, JSON or XML config nested deeper than 200 levels is not read either and is reported high with the label too deep.',
    example: '   coverageThreshold: {\n-    global: { lines: 90, branches: 80 },\n+    global: { lines: 70, branches: 80 },\n   },',
  },
  async run(ctx) {
    const entries: Array<{ f: ChangedFile; base: Threshold[]; head: Threshold[]; baseText?: string; headText?: string }> = [];
    const tooLarge: Finding[] = [];
    for (const f of ctx.files) {
      if (f.binary || !isThresholdFile(f.path)) continue;
      const t = await texts(ctx, f);
      if (t.tooLarge) {
        tooLarge.push(tooLargeFinding(ctx, 'C002', f, 'coverage thresholds', t.tooDeep));
        continue;
      }
      const e: (typeof entries)[number] = { f, base: thresholdsOf(f.oldPath ?? f.path, t.base), head: thresholdsOf(f.path, t.head) };
      if (t.base !== undefined) e.baseText = t.base;
      if (t.head !== undefined) e.headText = t.head;
      entries.push(e);
    }
    const allHead = entries.flatMap((e) => e.head.map((t) => ({ path: e.f.path, t })));
    const out: Finding[] = [...tooLarge];
    for (const e of entries) {
      const headByKey = new Map(e.head.map((t) => [t.key, t]));
      for (const b of e.base) {
        const h = headByKey.get(b.key);
        if (h && !weaker(h, b)) continue;
        if (!h && b.inverted) continue; // dropping an allowed drop is stricter
        const moved = allHead.some((o) => !(o.path === e.f.path && o.t.key === b.key) && o.t.metric === b.metric && !!o.t.inverted === !!b.inverted && !weaker(o.t, b));
        if (moved) continue;
        if (h) {
          out.push(
            makeFinding(ctx, 'C002', 'medium', e.f, b.key, `${e.f.path} lowers the coverage threshold ${b.key} from ${b.value} to ${h.value}`, {
              ...lineOpt(lineOf(e.headText, h.needle, String(h.value))),
              before: String(b.value),
              after: String(h.value),
            }),
          );
        } else {
          out.push(
            makeFinding(ctx, 'C002', 'high', e.f, b.key, `${e.f.path} removes the coverage threshold ${b.key} (was ${b.value})`, {
              ...lineOpt(e.f.status === 'deleted' ? undefined : lineOf(e.baseText, b.needle, String(b.value))),
              before: String(b.value),
            }),
          );
        }
      }
    }
    return out;
  },
};

function lineOpt(line: number | undefined): { line?: number } {
  return line !== undefined ? { line } : {};
}

// ---------------------------------------------------------------------------------------------------------------
// C003 passing with no tests

export const NO_TESTS_OK: Array<{ re: RegExp; what: string }> = [
  { re: /--passWithNoTests(?![\w-])(?!\s*=\s*false)/, what: '--passWithNoTests' },
  { re: /["']?\bpassWithNoTests["']?\s*:\s*true\b/, what: 'passWithNoTests: true' },
  { re: /--pass-with-no-tests\b/, what: '--pass-with-no-tests' },
  { re: /<failIfNoTests>\s*false\s*<\/failIfNoTests>/, what: '<failIfNoTests>false' },
  { re: /-DfailIfNoTests=false\b/, what: '-DfailIfNoTests=false' },
  { re: /\bfailOnNoDiscoveredTests\s*(?:=|\.set\(|\()\s*false\b/, what: 'failOnNoDiscoveredTests = false' },
  { re: /\bfailOnNoMatchingTests\s*(?:=|\.set\(|\()\s*false\b/, what: 'failOnNoMatchingTests = false' },
  { re: /--suppress-no-test-exit-code\b/, what: '--suppress-no-test-exit-code' },
];

function isC003File(f: ChangedFile): boolean {
  const b = baseName(f.path);
  return isCommandFile(f) || f.kind === 'runner-config' || f.kind === 'coverage-config' || MOCHARC.test(b) || JEST_JS.test(b) || VITEST.test(b) || PLAYWRIGHT.test(b);
}

/** C003 Passing with no tests enabled. */
export const C003: Rule = {
  id: 'C003',
  name: 'Passing with no tests enabled',
  group: 'C',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'config', 'workflow'],
  docs: {
    summary:
      'A test command, script, workflow or runner config now passes when no test is found: --passWithNoTests or passWithNoTests: true (Jest, Vitest), Playwright --pass-with-no-tests, Surefire or Failsafe <failIfNoTests>false</failIfNoTests> or -DfailIfNoTests=false, Gradle failOnNoDiscoveredTests = false or filter.failOnNoMatchingTests = false, pytest --suppress-no-test-exit-code. A typo in a path or a filter then turns the whole test run into a green no op.',
    falsePositives:
      'The same setting already present anywhere in the base version of the file is silent, and so is a line that only moved within the file. Commented out lines are ignored.',
    example: '-    "test": "jest",\n+    "test": "jest --passWithNoTests",',
  },
  async run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.files) {
      if (f.status === 'deleted' || f.binary || !isC003File(f)) continue;
      const removed = new Set(f.hunks.flatMap((h) => h.removed.map((l) => l.trim())));
      let baseText: string | undefined | null = null;
      for (const h of f.hunks) {
        for (let i = 0; i < h.added.length; i++) {
          const raw = h.added[i]!;
          const trimmed = raw.trim();
          if (removed.has(trimmed) || /^(#|\/\/|<!--|\*)/.test(trimmed)) continue;
          const hit = NO_TESTS_OK.find((s) => s.re.test(raw));
          if (!hit) continue;
          if (baseText === null) baseText = f.status === 'added' ? undefined : await ctx.readBase(f.oldPath ?? f.path);
          if (baseText !== undefined && hit.re.test(baseText)) continue;
          out.push(makeFinding(ctx, 'C003', 'high', f, hit.what, `${f.path} lets the test run pass when no test is found (${hit.what})`, { line: h.headStart + i, after: trimmed, snippet: trimmed }));
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// C001 test selection narrowed

export type MatchKind = 'glob' | 'regex' | 'prefix' | 'dirname' | 'nodeid' | 'jvm-path' | 'jvm-class' | 'none';

export interface Selector {
  /** Setting, such as `jest.testPathIgnorePatterns` or `pytest.addopts --ignore`. */
  key: string;
  kind: 'exclude' | 'include' | 'switch';
  pattern: string;
  match: MatchKind;
  /** Directory the pattern is relative to (the config file's directory). */
  root: string;
}

/** Files C001 reads. */
export function isSelectionFile(path: string): boolean {
  const b = baseName(path);
  return (
    b === 'package.json' ||
    b === 'jest.config.json' ||
    JEST_JS.test(b) ||
    VITEST.test(b) ||
    PLAYWRIGHT.test(b) ||
    MOCHARC.test(b) ||
    ['pytest.ini', 'tox.ini', 'setup.cfg', 'pyproject.toml', 'pom.xml', 'junit-platform.properties'].includes(b) ||
    GRADLE.test(b) ||
    TESTNG.test(b)
  );
}

function pytestSelectors(opts: { addopts?: unknown; testpaths?: unknown; norecursedirs?: unknown }, root: string, out: Selector[]): void {
  const words = Array.isArray(opts.addopts) ? opts.addopts.filter((x): x is string => typeof x === 'string').flatMap(shellWords) : typeof opts.addopts === 'string' ? shellWords(opts.addopts) : [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const take = (flag: string): string | undefined => (w === flag ? words[++i] : w.startsWith(`${flag}=`) ? w.slice(flag.length + 1) : undefined);
    let v: string | undefined;
    if ((v = take('--ignore-glob')) !== undefined) out.push({ key: 'pytest.addopts --ignore-glob', kind: 'exclude', pattern: v, match: 'glob', root });
    else if ((v = take('--ignore')) !== undefined) out.push({ key: 'pytest.addopts --ignore', kind: 'exclude', pattern: v, match: 'prefix', root });
    else if ((v = take('--deselect')) !== undefined) out.push({ key: 'pytest.addopts --deselect', kind: 'exclude', pattern: v, match: 'nodeid', root });
    else if (w === '-k') out.push({ key: 'pytest.addopts -k', kind: 'exclude', pattern: words[++i] ?? '', match: 'none', root });
    else if (/^-k./.test(w)) out.push({ key: 'pytest.addopts -k', kind: 'exclude', pattern: w.slice(2).replace(/^=/, ''), match: 'none', root });
  }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : []);
  for (const p of list(opts.testpaths)) out.push({ key: 'pytest.testpaths', kind: 'include', pattern: p, match: 'prefix', root });
  for (const p of list(opts.norecursedirs)) out.push({ key: 'pytest.norecursedirs', kind: 'exclude', pattern: p, match: 'dirname', root });
}

function jestSelectors(get: (key: string) => unknown[], root: string, out: Selector[]): void {
  for (const k of ['testPathIgnorePatterns', 'modulePathIgnorePatterns']) for (const v of get(k)) for (const p of strings(v)) out.push({ key: `jest.${k}`, kind: 'exclude', pattern: p, match: 'regex', root });
  for (const v of get('testMatch')) for (const p of strings(v)) out.push({ key: 'jest.testMatch', kind: 'include', pattern: p, match: 'glob', root });
  for (const v of get('testRegex')) for (const p of strings(v)) out.push({ key: 'jest.testRegex', kind: 'include', pattern: p, match: 'regex', root });
}

function mochaSelectors(obj: unknown, root: string, out: Selector[]): void {
  if (!isPlainObject(obj)) return;
  for (const p of strings(obj['spec'])) out.push({ key: 'mocha.spec', kind: 'include', pattern: p, match: 'glob', root });
  for (const k of ['ignore', 'exclude']) for (const p of strings(obj[k])) out.push({ key: `mocha.${k}`, kind: 'exclude', pattern: p, match: 'glob', root });
}

function pomSelectors(text: string, root: string, out: Selector[]): void {
  const doc = parseXml(text);
  if (!doc) return;
  for (const plugin of xmlAll(doc, 'plugin')) {
    const id = xmlText(xmlChild(plugin, 'artifactId')) ?? '';
    const tool = id === 'maven-surefire-plugin' ? 'surefire' : id === 'maven-failsafe-plugin' ? 'failsafe' : undefined;
    if (!tool) continue;
    for (const n of xmlAll(plugin, 'exclude')) if (n.parent?.name === 'excludes' && xmlText(n)) out.push({ key: `${tool}.excludes`, kind: 'exclude', pattern: xmlText(n)!, match: 'jvm-path', root });
    for (const n of xmlAll(plugin, 'include')) if (n.parent?.name === 'includes' && xmlText(n)) out.push({ key: `${tool}.includes`, kind: 'include', pattern: xmlText(n)!, match: 'jvm-path', root });
    for (const n of xmlAll(plugin, 'excludedGroups')) {
      for (const g of (xmlText(n) ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.push({ key: `${tool}.excludedGroups`, kind: 'exclude', pattern: g, match: 'none', root });
    }
  }
}

// The same headers as `(?:^|\n)[ \t]*(?:test|tasks.test|tasks.named("test")[^\n{]*|[^\n{]*\bTest\b[^\n{]*)\s*\{`, written
// so that no two quantifiers can split the same run of characters: that form took 6 s on a 100 kB line of `Test `.
// `(?=([ \t]*))\1` takes the indentation atomically; `[^\n{]*(?:\n\s*)?\{` is `[^\n{]*\s*\{` without the overlap.
const GRADLE_TEST_BLOCK = /(?:^|\n)(?=([ \t]*))\1(?:(?:test|tasks\.test)\s*\{|(?:tasks\.named\(\s*["']test["']\s*\)|(?=[^\n{]*\bTest\b))[^\n{]*(?:\n\s*)?\{)/;

function gradleSelectors(text: string, root: string, out: Selector[]): void {
  const quoted = (s: string): string[] => [...s.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  const add = (sel: Selector): void => {
    const k = `${sel.key}\0${sel.pattern}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(sel);
  };
  // Each optional token carries the whitespace after it (`(?:\(\s*)?`, not `\(?\s*` after another `\s*`): two
  // adjacent whitespace runs were quadratic on a long run of spaces.
  for (const { body } of blockBodies(text, GRADLE_TEST_BLOCK)) {
    for (const m of body.matchAll(/\bexclude\s*(?:\(\s*)?((?:["'][^"'\n]+["']\s*(?:,\s*)?)+)/g)) for (const p of quoted(m[1]!)) add({ key: 'gradle.test.exclude', kind: 'exclude', pattern: p, match: 'jvm-path', root });
    for (const m of body.matchAll(/\bexcludeTestsMatching\s*(?:\(\s*)?((?:["'][^"'\n]+["']\s*(?:,\s*)?)+)/g)) for (const p of quoted(m[1]!)) add({ key: 'gradle.test.filter.excludeTestsMatching', kind: 'exclude', pattern: p, match: 'jvm-class', root });
    for (const m of body.matchAll(/\b(excludeTags|excludeCategories|excludeGroups|excludeEngines)\s*(?:(?:\(|\+=|\.add(?:All)?\()\s*)?((?:(?:setOf\(|listOf\()?["'][^"'\n]+["']\s*(?:,\s*)?(?:\)\s*)?)+)/g)) {
      for (const p of quoted(m[2]!)) add({ key: `gradle.test.${m[1]}`, kind: 'exclude', pattern: p, match: 'none', root });
    }
  }
}

function testngSelectors(text: string, root: string, out: Selector[]): void {
  const doc = parseXml(text);
  if (!doc) return;
  for (const n of xmlAll(doc, 'exclude')) {
    const name = n.attrs['name'];
    if (!name) continue;
    const parent = n.parent?.name;
    if (parent === 'methods') {
      const cls = n.parent?.parent?.attrs['name'] ?? '';
      out.push({ key: 'testng.methods.exclude', kind: 'exclude', pattern: cls ? `${cls}#${name}` : name, match: 'none', root });
    } else if (parent === 'run') out.push({ key: 'testng.groups.exclude', kind: 'exclude', pattern: name, match: 'none', root });
    else if (parent === 'package') out.push({ key: 'testng.package.exclude', kind: 'exclude', pattern: name, match: 'none', root });
  }
}

/** Test selection settings in a config file, read as text. */
export function selectorsOf(path: string, text: string | undefined): Selector[] {
  if (text === undefined) return [];
  const b = baseName(path);
  const root = dirName(path);
  const out: Selector[] = [];
  try {
    if (b === 'package.json') {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      const jest = isPlainObject(pkg['jest']) ? pkg['jest'] : undefined;
      if (jest) jestSelectors((k) => (k in jest ? [jest[k]] : []), root, out);
      mochaSelectors(pkg['mocha'], root, out);
    } else if (b === 'jest.config.json') {
      const cfg = JSON.parse(text) as Record<string, unknown>;
      jestSelectors((k) => (k in cfg ? [cfg[k]] : []), root, out);
    } else if (JEST_JS.test(b)) {
      jestSelectors((k) => jsValuesForKey(text, k), root, out);
    } else if (VITEST.test(b)) {
      for (const t of jsValuesForKey(text, 'test')) {
        if (!isPlainObject(t)) continue;
        for (const p of strings(t['include'])) out.push({ key: 'vitest.test.include', kind: 'include', pattern: p, match: 'glob', root });
        for (const p of strings(t['exclude'])) out.push({ key: 'vitest.test.exclude', kind: 'exclude', pattern: p, match: 'glob', root });
      }
    } else if (PLAYWRIGHT.test(b)) {
      for (const v of jsValuesForKey(text, 'testIgnore')) for (const p of strings(v)) out.push({ key: 'playwright.testIgnore', kind: 'exclude', pattern: p, match: isRegexValue(v) ? 'regex' : 'glob', root });
      for (const v of jsValuesForKey(text, 'testMatch')) for (const p of strings(v)) out.push({ key: 'playwright.testMatch', kind: 'include', pattern: p, match: isRegexValue(v) ? 'regex' : 'glob', root });
    } else if (MOCHARC.test(b)) {
      if (isJsFile(b)) {
        const obj: Record<string, unknown> = {};
        for (const k of ['spec', 'ignore', 'exclude']) {
          const vs = jsValuesForKey(text, k);
          if (vs.length) obj[k] = vs.flatMap((v) => (Array.isArray(v) ? v : [v]));
        }
        mochaSelectors(obj, root, out);
      } else mochaSelectors(parseYamlOrJson(text), root, out);
    } else if (b === 'pytest.ini' || b === 'tox.ini' || b === 'setup.cfg') {
      const ini = parseIni(text);
      const sec = b === 'setup.cfg' ? ini['tool:pytest'] : ini['pytest'];
      if (sec) pytestSelectors(sec, root, out);
    } else if (b === 'pyproject.toml') {
      const doc = parseTomlSafe(text);
      const tool = isPlainObject(doc?.['tool']) ? doc['tool'] : {};
      const pytest = isPlainObject(tool['pytest']) ? tool['pytest'] : undefined;
      if (pytest) pytestSelectors(isPlainObject(pytest['ini_options']) ? pytest['ini_options'] : pytest, root, out);
    } else if (b === 'pom.xml') {
      pomSelectors(text, root, out);
    } else if (GRADLE.test(b)) {
      gradleSelectors(text, root, out);
    } else if (TESTNG.test(b)) {
      testngSelectors(text, root, out);
    } else if (b === 'junit-platform.properties') {
      const v = parseProperties(text)['junit.jupiter.conditions.deactivate'];
      if (v) out.push({ key: 'junit.jupiter.conditions.deactivate', kind: 'switch', pattern: v, match: 'none', root });
    }
  } catch {
    return [];
  }
  return out.filter((s) => s.pattern !== '' && !isOpaqueLit(s.pattern));
}

/** Directories that hold generated or installed files, never tests of the project. */
const GENERATED = new Set(['node_modules', 'dist', 'build', 'target', '.venv', 'venv', 'env', '.env', '.tox', '.nox', '__pycache__', 'coverage', '.git', 'out', '.next', '.nuxt', '.gradle', '.pytest_cache', '.mypy_cache', '.eggs', '*.egg', '.*', '{arch}', 'CVS', '_darcs', 'site-packages', 'bower_components', '.cache', 'tmp', '.idea', '.vscode', '.svn', '.hg']);

export function isGeneratedPattern(pattern: string): boolean {
  const p = pattern.replace(/<rootDir>/g, '').replace(/\\\./g, '.').replace(/\\\//g, '/');
  if (GENERATED.has(p.trim())) return true;
  for (const seg of p.split('/')) {
    const lead = seg.replace(/^[\^*?(|[\]{}+!]+/, '');
    const s = trimEndChars(lead, '*?$)|[]{}+!');
    if (s && GENERATED.has(s)) return true;
  }
  return false;
}

function relUnder(root: string, path: string): string | undefined {
  if (!root) return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined;
}

function cleanPath(p: string): string {
  return trimEndChars(p.replace(/<rootDir>\/?/g, '').replace(/^\.\//, ''), '/');
}

function jvmRel(rel: string): string {
  return rel.replace(/^(?:.*\/)?src\/(?:test|it|integrationTest|integration-test|testFixtures)\/(?:java|kotlin|groovy|scala)\//, '');
}

/** Unbounded quantifiers a selector regex may hold; each one multiplies the worst case backtracking by the path length. */
const MAX_REGEX_QUANTIFIERS = 3;

/**
 * Compile a selector regex from the head config, or undefined when it could backtrack catastrophically: a quantified
 * group that holds a quantifier or an alternation (`(a+)+`, `(a|a)*`), a backreference, more than a few unbounded
 * quantifiers, or a long source. The pattern comes from the pull request, and JavaScript cannot time out a match, so
 * an unsafe pattern is treated as one that cannot be evaluated (the finding stays high, without a file count).
 */
export function safeRegExp(source: string): RegExp | undefined {
  if (source.length > 1000 || /\\[1-9]|\\k</.test(source)) return undefined;
  const groups: Array<{ risky: boolean }> = [];
  let unbounded = 0;
  let lastGroupRisky = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    const quantifier = c === '*' || c === '+' || (c === '{' && /^\{\d*,?\d*\}/.test(source.slice(i, i + 24)));
    if (c === '\\') {
      i++;
      lastGroupRisky = false;
      continue;
    }
    if (c === '[') {
      for (i++; i < source.length && source[i] !== ']'; i++) if (source[i] === '\\') i++;
      lastGroupRisky = false;
      continue;
    }
    if (c === '(') {
      groups.push({ risky: false });
      lastGroupRisky = false;
      continue;
    }
    if (c === ')') {
      const g = groups.pop();
      lastGroupRisky = !!g?.risky;
      if (g?.risky && groups.length) groups[groups.length - 1]!.risky = true;
      continue;
    }
    if (c === '|') {
      if (groups.length) groups[groups.length - 1]!.risky = true;
      lastGroupRisky = false;
      continue;
    }
    if (quantifier || c === '?') {
      if (lastGroupRisky && c !== '?') return undefined;
      if (quantifier) {
        if (c !== '{' || /^\{\d*,\}/.test(source.slice(i, i + 24))) unbounded++;
        if (groups.length) groups[groups.length - 1]!.risky = true;
      }
      if (unbounded > MAX_REGEX_QUANTIFIERS) return undefined;
      lastGroupRisky = false;
      continue;
    }
    lastGroupRisky = false;
  }
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}

/** `*` matches any run of characters, everything else itself, over the whole string. At most pattern length times text length steps. */
export function wildcardMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** Head test files a selector matches, or undefined when the pattern cannot be evaluated against paths. */
export function selectorMatches(sel: Selector, tests: string[]): string[] | undefined {
  let test: ((rel: string, full: string) => boolean) | undefined;
  try {
    switch (sel.match) {
      case 'glob': {
        const p = cleanPath(sel.pattern).replace(/^\*\*\/\*\*\//, '**/');
        const m = picomatch(p, { dot: true });
        test = (rel) => {
          const parts = rel.split('/');
          for (let i = 0; i < parts.length; i++) if (m(parts.slice(i).join('/'))) return true;
          return false;
        };
        break;
      }
      case 'regex': {
        const re = safeRegExp(sel.pattern.replace(/<rootDir>/g, ''));
        if (!re) return undefined;
        test = (rel, full) => re.test(`/${rel}`) || re.test(`/${full}`);
        break;
      }
      case 'prefix': {
        const p = cleanPath(sel.pattern);
        if (/[*?[]/.test(p)) {
          const m = picomatch(p, { dot: true });
          test = (rel) => m(rel) || rel.split('/').some((_, i, a) => m(a.slice(0, i + 1).join('/')));
        } else test = (rel) => p === '' || p === '.' || rel === p || rel.startsWith(`${p}/`);
        break;
      }
      case 'dirname': {
        const m = picomatch(sel.pattern, { dot: true });
        test = (rel) => rel.split('/').slice(0, -1).some((d) => m(d));
        break;
      }
      case 'nodeid': {
        const p = cleanPath(sel.pattern.split('::')[0]!);
        test = (rel) => rel === p;
        break;
      }
      case 'jvm-path': {
        const raw = sel.pattern.trim();
        const rx = /^%regex\[(.*)\]$/.exec(raw);
        if (rx) {
          const re = safeRegExp(rx[1]!);
          if (!re) return undefined;
          test = (rel) => re.test(jvmRel(rel));
          break;
        }
        const variants = new Set([raw, raw.replace(/\.class$/, '.java'), raw.replace(/\.java$/, '.class')]);
        if (!/\.\w+$/.test(raw) && !raw.endsWith('*')) variants.add(`${raw}.java`);
        for (const v of [...variants]) if (!v.includes('/')) variants.add(`**/${v}`);
        const ms = [...variants].map((v) => picomatch(v, { dot: true }));
        test = (rel) => {
          const r = jvmRel(rel);
          const variantsOfFile = [r, r.replace(/\.(java|kt|groovy|scala)$/, '.class')];
          return ms.some((m) => variantsOfFile.some((x) => m(x)));
        };
        break;
      }
      case 'jvm-class': {
        const p = sel.pattern.trim();
        // A linear wildcard match, not a `^a.*b.*c$` regex: with many stars that regex backtracks polynomially.
        const re = { test: (x: string) => wildcardMatch(p, x) };
        test = (rel) => {
          const fqcn = jvmRel(rel).replace(/\.\w+$/, '').replace(/\//g, '.');
          const simple = fqcn.split('.').pop() ?? fqcn;
          return re.test(fqcn) || re.test(simple) || p.startsWith(`${fqcn}.`) || (!p.includes('.') && re.test(simple));
        };
        break;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
  const jvmOnly = sel.match === 'jvm-path' || sel.match === 'jvm-class';
  const out: string[] = [];
  for (const full of tests) {
    if (jvmOnly && !/\.(java|kt|groovy|scala)$/.test(full)) continue;
    const rel = relUnder(sel.root, full);
    if (rel !== undefined && test(rel, full)) out.push(full);
  }
  return out;
}

function sample(files: string[]): string {
  const head = files.slice(0, 2).join(', ');
  return files.length > 2 ? `${head} and ${files.length - 2} more` : head;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** C001 Test selection narrowed in config. */
export const C001: Rule = {
  id: 'C001',
  name: 'Test selection narrowed in config',
  group: 'C',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'config'],
  docs: {
    summary:
      'Runner configuration now selects fewer tests. pytest addopts gaining --ignore, --ignore-glob, --deselect or -k, testpaths narrowed, norecursedirs grown; Jest testPathIgnorePatterns or modulePathIgnorePatterns grown, testMatch or testRegex narrowed; Vitest test.include narrowed or test.exclude grown; Mocha spec narrowed or ignore grown in .mocharc; Playwright testIgnore grown or testMatch narrowed; Surefire or Failsafe <excludes> or <excludedGroups> grown, <includes> narrowed; Gradle test exclude(...), filter excludeTestsMatching, useJUnitPlatform excludeTags (and excludeCategories, excludeGroups) grown; TestNG suite <exclude> grown; junit.jupiter.conditions.deactivate set in junit-platform.properties (medium). Path patterns are matched against the test files of the head tree and the finding names how many it drops. Test tasks disabled outright (<skipTests>, <skip>, test { enabled = false }) are reported by W003.',
    falsePositives:
      'An exclusion of a generated or installed directory (node_modules, dist, build, target, .venv and the like) is silent. An exclusion whose pattern matches no test file in the head tree is low with the label matches nothing. An include pattern replaced by others that still cover every test file it matched is silent. The same pattern removed from the same setting in another file of the PR (a config moved from package.json to jest.config.js) is silent. Tags, groups, -k expressions and TestNG method excludes cannot be matched to files and stay high, as do regular expressions that could backtrack without bound (nested or alternated repetition, backreferences, more than three unbounded repeats), which are not run. A changed config file over 1 MB is not read and is reported high with the label too large; a YAML, JSON or XML config nested deeper than 200 levels is not read either and is reported high with the label too deep.',
    example: '   testPathIgnorePatterns: [\n     "/node_modules/",\n+    "<rootDir>/src/payments/",\n   ],',
  },
  async run(ctx) {
    const entries: Array<{ f: ChangedFile; base: Selector[]; head: Selector[]; headText?: string }> = [];
    const tooLarge: Finding[] = [];
    for (const f of ctx.files) {
      if (f.binary || !isSelectionFile(f.path)) continue;
      const t = await texts(ctx, f);
      if (t.tooLarge) {
        tooLarge.push(tooLargeFinding(ctx, 'C001', f, 'test selection', t.tooDeep));
        continue;
      }
      const e: (typeof entries)[number] = { f, base: selectorsOf(f.oldPath ?? f.path, t.base), head: selectorsOf(f.path, t.head) };
      if (t.head !== undefined) e.headText = t.head;
      if (e.base.length || e.head.length) entries.push(e);
    }
    if (!entries.length) return tooLarge;
    const tests = await ctx.headTestFiles();
    const id = (s: Selector): string => `${s.key}\0${s.pattern}`;
    // Patterns removed from a setting in one file of the PR, for the moved control.
    const removedIn = new Map<string, Set<string>>();
    for (const e of entries) {
      const head = new Set(e.head.map(id));
      for (const b of e.base) if (!head.has(id(b))) (removedIn.get(id(b)) ?? removedIn.set(id(b), new Set()).get(id(b))!).add(e.f.path);
    }
    const out: Finding[] = [...tooLarge];
    for (const e of entries) {
      const base = new Set(e.base.map(id));
      const lineFor = (s: Selector) => lineOpt(lineOf(e.headText, s.pattern) ?? lineOf(e.headText, s.key.split(/[ .]/).pop() ?? s.key));
      for (const h of e.head) {
        if (base.has(id(h))) continue;
        if (h.kind === 'switch') {
          const before = e.base.find((b) => b.key === h.key)?.pattern;
          out.push(makeFinding(ctx, 'C001', 'medium', e.f, `${h.key} ${h.pattern}`, `${e.f.path} sets ${h.key} to ${h.pattern}, which changes which tests run`, { ...lineFor(h), after: h.pattern, ...(before ? { before } : {}) }));
          continue;
        }
        if (h.kind !== 'exclude') continue;
        if ([...(removedIn.get(id(h)) ?? [])].some((p) => p !== e.f.path)) continue;
        if (isGeneratedPattern(h.pattern)) continue;
        const hits = selectorMatches(h, tests);
        const subject = `${h.key} ${h.pattern}`;
        if (hits && hits.length === 0) {
          out.push(makeFinding(ctx, 'C001', 'low', e.f, subject, `${e.f.path} excludes ${h.pattern} from the test run (${h.key}); it matches no test file in the head tree`, { ...lineFor(h), after: h.pattern, label: 'matches nothing' }));
        } else {
          const what = hits ? `, dropping ${plural(hits.length, 'test file')} (${sample(hits)})` : '';
          out.push(makeFinding(ctx, 'C001', 'high', e.f, subject, `${e.f.path} excludes ${h.pattern} from the test run (${h.key})${what}`, { ...lineFor(h), after: h.pattern }));
        }
      }
      // Include lists narrowed: a base pattern gone while the list still exists.
      const keys = new Set(e.base.filter((s) => s.kind === 'include').map((s) => s.key));
      for (const key of keys) {
        const headList = e.head.filter((s) => s.key === key);
        if (!headList.length) continue;
        const headIds = new Set(headList.map(id));
        for (const b of e.base.filter((s) => s.key === key && !headIds.has(id(s)))) {
          const matched = selectorMatches(b, tests);
          let lost: string[] | undefined;
          if (matched) {
            const kept = new Set<string>();
            for (const h of headList) {
              const m = selectorMatches(h, tests);
              if (!m) {
                lost = [];
                break;
              }
              for (const x of m) kept.add(x);
            }
            lost ??= matched.filter((x) => !kept.has(x));
            if (!lost.length) continue;
          }
          const what = lost ? `, dropping ${plural(lost.length, 'test file')} (${sample(lost)})` : '';
          out.push(makeFinding(ctx, 'C001', 'high', e.f, `${key} -${b.pattern}`, `${e.f.path} narrows ${key}: ${b.pattern} is no longer selected${what}`, { ...lineOpt(lineOf(e.headText, key.split(/[ .]/).pop() ?? key)), before: b.pattern, after: headList.map((s) => s.pattern).join(', ') }));
        }
      }
    }
    return out;
  },
};

export function rulesC(): Rule[] {
  return [C001, C002, C003];
}
