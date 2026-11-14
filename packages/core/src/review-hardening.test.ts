// Regressions from the 4 Nov review: inputs a pull request controls (config files, workflow lines) that made a rule
// backtrack quadratically or worse, and the equivalence of the linear replacements with the patterns they replace.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockBodies, jsValuesForKey, parseIni } from './config-text.js';
import { parseConfig } from './config.js';
import { readCoverageFiles } from './coverage/reader.js';
import { esc } from './report/markdown.js';
import { C001, C002, CONFIG_TEXT_MAX_BYTES } from './rules/C.js';
import { templateRegex } from './rules/V.js';
import { context } from './rules/testkit.js';
import { classKey, nameKey } from './evidence/normalise.js';
import { safeRegExp, selectorMatches, selectorsOf, thresholdsOf, wildcardMatch } from './rules/C.js';
import { stripQuoted, S004, W003 } from './rules/W.js';
import type { ChangedFile, RuleContext } from './types.js';
const TIMING_OFF = process.env['TESTWITNESS_TIMING'] === 'off'; // Stryker instruments the code under test, so wall clock budgets do not apply there

const N = 100_000;
const BUDGET_MS = TIMING_OFF ? Number.POSITIVE_INFINITY : 2000;

function timed<T>(f: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = f();
  return { value, ms: performance.now() - t0 };
}

describe('config readers on hostile text', () => {
  it('reads an INI line with a long run of spaces in linear time', () => {
    for (const text of [`[pytest]\naddopts = a${' '.repeat(N)}b`, `[pytest]\na${' '.repeat(N)}b`]) {
      expect(timed(() => parseIni(text)).ms).toBeLessThan(BUDGET_MS);
      expect(timed(() => selectorsOf('setup.cfg', text.replace('[pytest]', '[tool:pytest]'))).ms).toBeLessThan(BUDGET_MS);
    }
  });

  it('parses INI keys, values and inline comments as before', () => {
    const ini = parseIni('[pytest]\naddopts = -q --ignore=x  # why\nTest-Paths: tests ; note\nnorecursedirs=a;b\nmarkers =\n  slow: long\n');
    expect(ini['pytest']).toEqual({ addopts: '-q --ignore=x', test_paths: 'tests', norecursedirs: 'a;b', markers: '\nslow: long' });
  });

  it('reads a threshold with a long run of spaces in linear time', () => {
    const codecov = (target: string) => JSON.stringify({ coverage: { status: { project: { default: { target } } } } });
    const r = timed(() => thresholdsOf('codecov.yml', codecov(`80${' '.repeat(N)}x`)));
    expect(r.ms).toBeLessThan(BUDGET_MS);
    expect(r.value).toEqual([]);
    expect(thresholdsOf('codecov.yml', codecov(' 80 % ')).map((t) => t.value)).toEqual([80]);
  });

  it('finds Gradle test blocks in linear time on a line of repeated Test words and unclosed blocks', () => {
    expect(timed(() => selectorsOf('build.gradle', 'Test '.repeat(N / 5))).ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => thresholdsOf('build.gradle', 'violationRules limit {'.repeat(N / 22))).ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => selectorsOf('build.gradle', `${' '.repeat(N)}x`)).ms).toBeLessThan(BUDGET_MS);
  });

  it('still finds the Gradle test block headers it found before', () => {
    const text = 'test {\n  exclude "**/A*"\n}\ntasks.named("test") {\n  exclude "**/B*"\n}\ntasks.withType(Test)\n{\n  exclude "**/C*"\n}\n';
    expect(selectorsOf('build.gradle', text).map((s) => s.pattern)).toEqual(['**/A*', '**/B*', '**/C*']);
    expect(blockBodies('limit { a } limit { b', /\blimit\s*\{/).map((b) => b.body.trim())).toEqual(['a', 'b']);
  });
});

describe('selector patterns from the head config', () => {
  it('refuses regexes that can backtrack catastrophically, so the finding stays high without a count', () => {
    for (const p of ['(a+)+$', '(a|aa)*$', '(.*a){3}x', '(\\w+\\s?)+$', 'a.*a.*a.*a.*b', '(a)\\1']) expect(safeRegExp(p)).toBeUndefined();
    const hostile = { key: 'jest.testPathIgnorePatterns', kind: 'exclude' as const, pattern: '(a+)+$', match: 'regex' as const, root: '' };
    const r = timed(() => selectorMatches(hostile, [`src/${'a'.repeat(40)}!.test.ts`]));
    expect(r.value).toBeUndefined();
    expect(r.ms).toBeLessThan(BUDGET_MS);
  });

  it('keeps the regexes real configs use', () => {
    for (const p of ['/node_modules/', '<rootDir>/src/payments/', '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$', '\\.e2e\\.(js|ts)$', 'src/[^/]+/legacy/.*', '.*Slow.*\\.java']) {
      expect(safeRegExp(p.replace('<rootDir>', ''))).toBeInstanceOf(RegExp);
    }
  });

  it('matches JVM class wildcards like the anchored regex did, in linear time', () => {
    const toRegex = (p: string) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    fc.assert(
      fc.property(fc.stringMatching(/^[ab.*]{0,8}$/), fc.stringMatching(/^[ab.]{0,10}$/), (p, s) => wildcardMatch(p, s) === toRegex(p).test(s)),
      { numRuns: 2000 },
    );
    const sel = { key: 'surefire.excludes', kind: 'exclude' as const, pattern: `${'a*'.repeat(40)}b`, match: 'jvm-class' as const, root: '' };
    expect(timed(() => selectorMatches(sel, [`src/test/java/${'a'.repeat(200)}.java`])).ms).toBeLessThan(BUDGET_MS);
  });
});

describe('W003 and S004 on hostile workflow lines', () => {
  const OLD_STRIP = (line: string) => line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');

  it('strips quoted strings exactly as the old regex did', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a"'\\ ]{0,24}$/), (s) => stripQuoted(s) === OLD_STRIP(s)), { numRuns: 5000 });
  });

  it('keeps the rewritten snapshot and test task patterns equivalent to the old ones', () => {
    const pairs: Array<[RegExp, RegExp]> = [
      [/\b(jest|vitest)\b[^|&;]*\s(-u|--updateSnapshot|--update)\b/, /(?:^|[|&;])(?:(?!\b(?:jest|vitest)\b)[^|&;])*\b(jest|vitest)\b[^|&;]*\s(-u|--updateSnapshot|--update)\b/],
      [/\btasks\.(test|withType<Test>)\s*\{[^}]*enabled\s*=\s*false/, /(?:^|\})(?:(?!\btasks\.(?:test|withType<Test>)\s*\{)[^}])*\btasks\.(test|withType<Test>)\s*\{[^}]*enabled\s*=\s*false/],
      [/\bsnapshot(s)?\s*:\s*\{[^}]*\bupdate\s*:\s*true/, /(?:^|\})(?:(?!\bsnapshots?\s*:\s*\{)[^}])*\bsnapshot(s)?\s*:\s*\{[^}]*\bupdate\s*:\s*true/],
    ];
    const tokens = ['jest', 'vitest', ' ', '-u', '--update', '|', ';', 'x', 'tasks.test', '{', '}', 'enabled = false', 'snapshot:', 'update: true', 'a'];
    const line = fc.array(fc.constantFrom(...tokens), { maxLength: 10 }).map((a) => a.join(''));
    for (const [before, after] of pairs) fc.assert(fc.property(line, (s) => before.test(s) === after.test(s)), { numRuns: 3000 });
  });

  it('checks a 100 kB hostile line within the budget', () => {
    for (const bad of ['"\\'.repeat(N / 2), 'jest '.repeat(N / 5), 'tasks.test {'.repeat(N / 12), 'snapshot:{'.repeat(N / 10), `name:${' '.repeat(N)}`, 'pytest '.repeat(N / 7)]) {
      const f = { path: '.github/workflows/ci.yml', kind: 'ci-workflow', status: 'modified', binary: false, hunks: [{ headStart: 1, headLines: 3, baseStart: 1, baseLines: 0, added: [bad, `run: ${bad}`, `    - name:${bad}`], removed: [] }] } as unknown as ChangedFile;
      const ctx = { files: [f], fingerprint: () => 'x' } as unknown as RuleContext;
      expect(timed(() => [W003.run(ctx), S004.run(ctx)]).ms).toBeLessThan(BUDGET_MS);
    }
  });
});

describe('test name keys on hostile result names', () => {
  // The implementation before the review, kept here to prove the linear one gives the same keys.
  const oldCollapse = (s: string) => s.replace(/\s+(?:›|>)\s+/g, ' ');
  function oldStrip(n: string): string {
    const m = /(?:#\d+|\{\d+\})\s*$/.exec(n);
    if (m) return n.slice(0, m.index);
    const t = n.replace(/\s+$/, '');
    const close = t[t.length - 1];
    if (close !== ']' && close !== ')') return n;
    const open = close === ']' ? '[' : '(';
    let depth = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] === close) depth++;
      else if (t[i] === open && --depth === 0) return t.slice(0, i);
    }
    return n;
  }
  function oldNameKey(name: string): string {
    let n = name.trim();
    let prev: string;
    do {
      prev = n;
      n = oldStrip(n).replace(/\s+$/, '');
    } while (n !== prev && n.length > 0);
    if (!n) n = name.trim();
    return oldCollapse(n).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  const oldClassKey = (c: string) => (/\s/.test(c.trim()) && !/[\\/]/.test(c) && !/\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/.test(c.trim()) ? oldCollapse(c.trim()).replace(/\s+/g, ' ').trim().toLowerCase() : classKey(c));

  it('gives the same keys as before', () => {
    const name = fc.array(fc.constantFrom('a', 'B', ' ', '\t', '>', '›', '#', '1', '2', '{', '}', '[', ']', '(', ')', ' > ', ' › '), { maxLength: 14 }).map((a) => a.join(''));
    fc.assert(fc.property(name, (s) => nameKey(s) === oldNameKey(s) && classKey(s) === oldClassKey(s)), { numRuns: 10_000 });
  });

  it('builds a key for a 100 kB hostile name within the budget', () => {
    for (const bad of [`a${' '.repeat(N)}b`, `a${'[]'.repeat(N / 2)}`, `a${'()'.repeat(N / 2)}`, `a${'#1'.repeat(N / 2)}`]) {
      expect(timed(() => [nameKey(bad), classKey(bad)]).ms).toBeLessThan(BUDGET_MS);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Decisions on the open items of the review.

function configCtx(path: string, base: string, head: string): RuleContext {
  const c = context({ pairs: [] });
  c.files = [{ status: 'modified', path, kind: 'runner-config', hunks: [{ baseStart: 1, baseCount: 1, headStart: 1, headCount: 1, removed: ['a'], added: ['b'] }], binary: false, addedLines: new Set([1]), removedLines: new Set([1]) } as unknown as ChangedFile];
  c.readBase = async () => base;
  c.readHead = async () => head;
  c.headTestFiles = async () => ['src/a.test.js'];
  return c;
}

describe('config text over the cap fails closed', () => {
  it('reports a changed config over 1 MB at high with the label too large, without reading it', async () => {
    const huge = `module.exports = { testPathIgnorePatterns: ['/src/'], coverageThreshold: { global: { lines: 90 } }, pad: '${'x'.repeat(CONFIG_TEXT_MAX_BYTES)}' };`;
    const small = "module.exports = { coverageThreshold: { global: { lines: 90 } } };";
    for (const rule of [C001, C002]) {
      const t = timed(() => rule.run(configCtx('jest.config.js', small, huge)));
      const out = await t.value;
      expect(t.ms).toBeLessThan(BUDGET_MS);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ruleId: rule.id, severity: 'high', label: 'too large' });
    }
  });

  it('keeps reading a config under the cap', async () => {
    const out = await C002.run(configCtx('jest.config.js', 'module.exports = { coverageThreshold: { global: { lines: 90 } } };', 'module.exports = { coverageThreshold: { global: { lines: 70 } } };'));
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('reads a key repeated thousands of times in bounded time (1 MB)', () => {
    const text = 'coverageThreshold: '.repeat(1_000_000 / 19);
    expect(timed(() => jsValuesForKey(text, 'coverageThreshold')).ms).toBeLessThan(BUDGET_MS);
    expect(jsValuesForKey('a: { coverage: 1 }, b: { coverage: 2 }', 'coverage')).toEqual([1, 2]);
  });
});

describe('templateRegex', () => {
  const oldRegex = (key: string) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + escaped.replace(/%[sdifjop#]/g, '.+?').replace(/\\\$\w+/g, '.+?') + '$');
  };

  it('matches like the old regex for keys up to the placeholder cap', () => {
    const key = fc.array(fc.constantFrom('a', 'b', ' ', '%s', '%d', '$x'), { maxLength: 8 }).map((a) => a.join(''));
    const row = fc.stringMatching(/^[ab 1x$%sd]{0,10}$/);
    fc.assert(fc.property(key, row, (k, r) => templateRegex(k).test(r) === oldRegex(k).test(r)), { numRuns: 20_000 });
  });

  it('answers a near miss on twelve placeholders at once (the old regex ran for minutes)', () => {
    const t = timed(() => templateRegex(`x${'%s'.repeat(12)}`).test(`x${'a'.repeat(40_000)}\u2028`));
    expect(t.value).toBe(false);
    expect(t.ms).toBeLessThan(BUDGET_MS);
    const u = timed(() => templateRegex(`a${' %s a'.repeat(12)}!`).test('a a'.repeat(30_000)));
    expect(u.value).toBe(false);
    expect(u.ms).toBeLessThan(BUDGET_MS);
  });

  it('matches a key with more than twelve placeholders by its literal prefix', () => {
    const m = templateRegex(`sums ${'%i '.repeat(13)}`);
    expect(m.test('sums 1 2 3')).toBe(true);
    expect(m.test('adds 1')).toBe(false);
  });
});

describe('esc on user controlled text', () => {
  it('breaks mentions and bare links', () => {
    const out = esc('ping @octo-org/security and @alice, see https://evil.test/x and www.evil.test, mail bob@example.com');
    expect(out).not.toMatch(/@[a-z]/i);
    expect(out).toContain('&#64;&#8203;octo-org/security');
    expect(out).toContain('https:&#8203;//evil.test/x');
    expect(out).toContain('www&#8203;.evil.test');
    expect(out).toContain('bob&#64;&#8203;example.com');
    expect(out).not.toMatch(/https?:\/\//);
  });

  it('leaves ordinary text alone', () => {
    expect(esc('rounds up to 1:30 in http mode')).toBe('rounds up to 1:30 in http mode');
  });
});

describe('coverage readers never fail the check', () => {
  it('turns a missing file and a directory into notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-readers-'));
    mkdirSync(join(dir, 'lcov.info'));
    writeFileSync(join(dir, 'ok.info'), 'SF:src/a.ts\nDA:1,1\nend_of_record\n');
    const paths = [join(dir, 'gone.info'), join(dir, 'lcov.info'), join(dir, 'ok.info')];
    const cov = await readCoverageFiles(paths, dir);
    expect(cov.sources).toEqual([join(dir, 'ok.info')]);
    expect(cov.warnings.filter((w) => /not read/.test(w))).toHaveLength(2);
  });
});

describe('paths.followSymlinks', () => {
  it('defaults to false and reads a boolean', () => {
    expect(parseConfig(undefined).paths.followSymlinks).toBe(false);
    expect(parseConfig('version: 1\npaths:\n  followSymlinks: true\n').paths.followSymlinks).toBe(true);
    expect(() => parseConfig('version: 1\npaths:\n  followSymlinks: yes please\n')).toThrow(/followSymlinks/);
  });
});
