/**
 * Deterministic benchmark repository generator.
 *
 * Builds a temporary git repository with a base commit and a head commit that
 * touches every file, plus a JUnit XML set that covers the head tests. All
 * content comes from a seeded PRNG so two runs with the same options produce
 * byte identical files and identical commit SHAs.
 *
 * Shapes:
 *   TypeScript Jest     src/<pkg>/<name>.ts, src/<pkg>/<name>.test.ts
 *   Java JUnit 5        src/main/java/com/acme/<pkg>/<Name>.java, src/test/java/com/acme/<pkg>/<Name>Test.java
 *   Python pytest       app/<pkg>/<name>.py, tests/<pkg>/test_<name>.py
 *
 * The XML set has three producer shapes: pytest (one file, file and line
 * attributes, system-out per testcase), jest-junit (one file, default
 * classname and name both equal to the full title, suite level console
 * output) and Surefire (one TEST-<class>.xml per class with a properties
 * block and CDATA system-out).
 */

import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Mutations {
  deleted: number;
  skipped: number;
  loosened: number;
  newWithoutAssertion: number;
}

export interface GenerateOptions {
  /** Directory to create; removed first if it exists. */
  dir: string;
  seed: number;
  /** Total files in the base commit (test files plus production files). */
  files: number;
  testFiles: number;
  /** Target size of the whole JUnit XML set in bytes. */
  xmlBytes: number;
  mutations: Mutations;
  /** Minimum and maximum tests per test file. */
  testsPerFile?: [number, number];
}

export interface GenerateResult {
  repo: string;
  junitDir: string;
  junitGlob: string;
  baseSha: string;
  headSha: string;
  files: number;
  testFiles: number;
  tests: number;
  xmlFiles: number;
  xmlBytes: number;
  mutations: Mutations & { neutralTests: number; production: number };
}

type Lang = 'ts' | 'java' | 'py';
const LANGS: Lang[] = ['ts', 'java', 'py'];

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = ['cart', 'invoice', 'ledger', 'order', 'shipment', 'account', 'payment', 'refund', 'coupon', 'catalog', 'session', 'profile', 'basket', 'quote', 'tax', 'warehouse', 'route', 'ticket', 'booking', 'subscription'];
const VERBS = ['adds', 'removes', 'totals', 'applies', 'rejects', 'merges', 'splits', 'validates', 'formats', 'rounds', 'caps', 'resets', 'clears', 'counts', 'filters'];
const PKGS = ['billing', 'orders', 'inventory', 'shipping', 'accounts', 'pricing', 'reports', 'auth', 'search', 'notify'];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}
function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Oracle = 'equals' | 'throws' | 'length' | 'greater';

interface TestModel {
  /** Base name without the framework specific prefix, snake case words. */
  words: string[];
  oracle: Oracle;
  qty: number;
  price: number;
  /** Head only mutations. */
  skipped?: boolean;
  loosened?: boolean;
  noAssertion?: boolean;
  neutral?: boolean;
}

interface FileModel {
  lang: Lang;
  pkg: string;
  noun: string;
  index: number;
  tests: TestModel[];
}

function testName(t: TestModel, lang: Lang): string {
  if (lang === 'py') return 'test_' + t.words.join('_');
  if (lang === 'java') return t.words[0] + t.words.slice(1).map(cap).join('');
  return t.words.join(' ');
}

function prodPath(f: FileModel): string {
  const n = f.noun + f.index;
  if (f.lang === 'ts') return `src/${f.pkg}/${n}.ts`;
  if (f.lang === 'java') return `src/main/java/com/acme/${f.pkg}/${cap(n)}.java`;
  return `app/${f.pkg}/${n}.py`;
}

function testPath(f: FileModel): string {
  const n = f.noun + f.index;
  if (f.lang === 'ts') return `src/${f.pkg}/${n}.test.ts`;
  if (f.lang === 'java') return `src/test/java/com/acme/${f.pkg}/${cap(n)}Test.java`;
  return `tests/${f.pkg}/test_${n}.py`;
}

function className(f: FileModel): string {
  return cap(f.noun) + f.index;
}

function prodSource(f: FileModel, head: boolean): string {
  const cls = className(f);
  const note = head ? ' // reviewed' : '';
  const limit = head ? 1000 : 500;
  if (f.lang === 'ts') {
    return [
      `export interface ${cls}Line {`,
      `  sku: string;`,
      `  qty: number;`,
      `  unitPrice: number;`,
      `}`,
      ``,
      `export const MAX_LINES = ${limit};${note}`,
      ``,
      `export class ${cls} {`,
      `  private readonly lines: ${cls}Line[] = [];`,
      ``,
      `  add(sku: string, qty: number, unitPrice: number): void {`,
      `    if (qty <= 0) throw new Error('quantity must be positive');`,
      `    if (this.lines.length >= MAX_LINES) throw new Error('too many lines');`,
      `    this.lines.push({ sku, qty, unitPrice });`,
      `  }`,
      ``,
      `  remove(sku: string): boolean {`,
      `    const i = this.lines.findIndex((l) => l.sku === sku);`,
      `    if (i === -1) return false;`,
      `    this.lines.splice(i, 1);`,
      `    return true;`,
      `  }`,
      ``,
      `  size(): number {`,
      `    return this.lines.length;`,
      `  }`,
      ``,
      `  total(): number {`,
      `    return this.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);`,
      `  }`,
      `}`,
      ``,
    ].join('\n');
  }
  if (f.lang === 'java') {
    return [
      `package com.acme.${f.pkg};`,
      ``,
      `import java.util.ArrayList;`,
      `import java.util.List;`,
      ``,
      `public class ${cls} {`,
      `  public static final int MAX_LINES = ${limit};${note}`,
      `  private final List<int[]> lines = new ArrayList<>();`,
      ``,
      `  public void add(String sku, int qty, int unitPrice) {`,
      `    if (qty <= 0) throw new IllegalArgumentException("quantity must be positive");`,
      `    if (lines.size() >= MAX_LINES) throw new IllegalStateException("too many lines");`,
      `    lines.add(new int[] { qty, unitPrice });`,
      `  }`,
      ``,
      `  public int size() {`,
      `    return lines.size();`,
      `  }`,
      ``,
      `  public int total() {`,
      `    int sum = 0;`,
      `    for (int[] l : lines) sum += l[0] * l[1];`,
      `    return sum;`,
      `  }`,
      `}`,
      ``,
    ].join('\n');
  }
  return [
    `"""${cls} domain object."""`,
    ``,
    `MAX_LINES = ${limit}${head ? '  # reviewed' : ''}`,
    ``,
    ``,
    `class ${cls}:`,
    `    def __init__(self):`,
    `        self.lines = []`,
    ``,
    `    def add(self, sku, qty, unit_price):`,
    `        if qty <= 0:`,
    `            raise ValueError("quantity must be positive")`,
    `        if len(self.lines) >= MAX_LINES:`,
    `            raise RuntimeError("too many lines")`,
    `        self.lines.append((sku, qty, unit_price))`,
    ``,
    `    def size(self):`,
    `        return len(self.lines)`,
    ``,
    `    def total(self):`,
    `        return sum(q * p for _, q, p in self.lines)`,
    ``,
  ].join('\n');
}

function tsTest(f: FileModel, t: TestModel): string {
  const cls = className(f);
  const v = t.neutral ? 'basket' : 'cart';
  const fn = t.skipped ? 'it.skip' : 'it';
  const body: string[] = [`    const ${v} = new ${cls}();`];
  if (t.noAssertion) {
    body.push(`    ${v}.add('sku-${t.qty}', ${t.qty}, ${t.price});`, `    ${v}.total();`);
  } else if (t.oracle === 'throws') {
    body.push(t.loosened ? `    expect(() => ${v}.add('sku-0', 0, ${t.price})).toBeDefined();` : `    expect(() => ${v}.add('sku-0', 0, ${t.price})).toThrow('quantity must be positive');`);
  } else {
    body.push(`    ${v}.add('sku-${t.qty}', ${t.qty}, ${t.price});`);
    if (t.oracle === 'equals') body.push(t.loosened ? `    expect(${v}.total()).toBeDefined();` : `    expect(${v}.total()).toBe(${t.qty * t.price});`);
    else if (t.oracle === 'length') body.push(t.loosened ? `    expect(${v}.size()).toBeTruthy();` : `    expect(${v}.size()).toBe(1);`);
    else body.push(t.loosened ? `    expect(${v}.total()).toBeDefined();` : `    expect(${v}.total()).toBeGreaterThan(${t.qty * t.price - 1});`);
  }
  return [`  ${fn}('${testName(t, 'ts')}', () => {`, ...body, `  });`].join('\n');
}

function javaTest(f: FileModel, t: TestModel): string {
  const cls = className(f);
  const v = t.neutral ? 'basket' : 'cart';
  const ann = t.skipped ? `  @Test\n  @Disabled\n` : `  @Test\n`;
  const body: string[] = [`    ${cls} ${v} = new ${cls}();`];
  if (t.noAssertion) {
    body.push(`    ${v}.add("sku-${t.qty}", ${t.qty}, ${t.price});`, `    ${v}.total();`);
  } else if (t.oracle === 'throws') {
    body.push(t.loosened ? `    assertNotNull(${v});` : `    assertThrows(IllegalArgumentException.class, () -> ${v}.add("sku-0", 0, ${t.price}));`);
  } else {
    body.push(`    ${v}.add("sku-${t.qty}", ${t.qty}, ${t.price});`);
    if (t.oracle === 'equals') body.push(t.loosened ? `    assertNotNull(${v}.total());` : `    assertEquals(${t.qty * t.price}, ${v}.total());`);
    else if (t.oracle === 'length') body.push(t.loosened ? `    assertNotNull(${v}.size());` : `    assertEquals(1, ${v}.size());`);
    else body.push(t.loosened ? `    assertNotNull(${v}.total());` : `    assertTrue(${v}.total() > ${t.qty * t.price - 1});`);
  }
  return [`${ann}  void ${testName(t, 'java')}() {`, ...body, `  }`].join('\n');
}

function pyTest(f: FileModel, t: TestModel): string {
  const cls = className(f);
  const v = t.neutral ? 'basket' : 'cart';
  const deco = t.skipped ? `@pytest.mark.skip\n` : '';
  const body: string[] = [`    ${v} = ${cls}()`];
  if (t.noAssertion) {
    body.push(`    ${v}.add("sku-${t.qty}", ${t.qty}, ${t.price})`, `    ${v}.total()`);
  } else if (t.oracle === 'throws') {
    body.push(t.loosened ? `    assert ${v}` : `    with pytest.raises(ValueError):`, ...(t.loosened ? [] : [`        ${v}.add("sku-0", 0, ${t.price})`]));
  } else {
    body.push(`    ${v}.add("sku-${t.qty}", ${t.qty}, ${t.price})`);
    if (t.oracle === 'equals') body.push(t.loosened ? `    assert ${v}.total()` : `    assert ${v}.total() == ${t.qty * t.price}`);
    else if (t.oracle === 'length') body.push(t.loosened ? `    assert ${v}.size()` : `    assert ${v}.size() == 1`);
    else body.push(t.loosened ? `    assert ${v}.total()` : `    assert ${v}.total() > ${t.qty * t.price - 1}`);
  }
  return [`${deco}def ${testName(t, 'py')}():`, ...body].join('\n');
}

function testSource(f: FileModel, tests: TestModel[]): string {
  const cls = className(f);
  const n = f.noun + f.index;
  if (f.lang === 'ts') {
    return [`import { ${cls} } from './${n}';`, ``, `describe('${cls}', () => {`, tests.map((t) => tsTest(f, t)).join('\n\n'), `});`, ``].join('\n');
  }
  if (f.lang === 'java') {
    return [
      `package com.acme.${f.pkg};`,
      ``,
      `import org.junit.jupiter.api.Disabled;`,
      `import org.junit.jupiter.api.Test;`,
      `import static org.junit.jupiter.api.Assertions.*;`,
      ``,
      `class ${cls}Test {`,
      tests.map((t) => javaTest(f, t)).join('\n\n'),
      `}`,
      ``,
    ].join('\n');
  }
  return [`import pytest`, ``, `from app.${f.pkg}.${n} import ${cls}`, ``, ``, tests.map((t) => pyTest(f, t)).join('\n\n\n'), ``].join('\n');
}

/** Test as it exists in the head commit, or undefined when deleted. */
function headTests(f: FileModel, kind: HeadKind, r: () => number): TestModel[] {
  const tests = f.tests.map((t) => ({ ...t }));
  const k = int(r, 0, tests.length - 1);
  switch (kind) {
    case 'deleted':
      tests.splice(k, 1);
      break;
    case 'skipped':
      tests[k]!.skipped = true;
      break;
    case 'loosened': {
      // Loosen a value assertion on the same subject (equality to a smoke check); exception oracles are left alone.
      const candidates = tests.map((t, i) => (t.oracle === 'throws' ? -1 : i)).filter((i) => i >= 0);
      const j = candidates.length ? candidates[k % candidates.length]! : k;
      tests[j]!.loosened = true;
      break;
    }
    case 'newWithoutAssertion':
      tests.push({ words: ['smoke', 'runs', String(tests.length + 1)], oracle: 'equals', qty: int(r, 1, 9), price: int(r, 1, 50), noAssertion: true });
      break;
    case 'neutral':
      tests[k]!.neutral = true;
      break;
  }
  return tests;
}

type HeadKind = 'deleted' | 'skipped' | 'loosened' | 'newWithoutAssertion' | 'neutral';

function headKindFor(i: number, m: Mutations): HeadKind {
  if (i < m.deleted) return 'deleted';
  if (i < m.deleted + m.skipped) return 'skipped';
  if (i < m.deleted + m.skipped + m.loosened) return 'loosened';
  if (i < m.deleted + m.skipped + m.loosened + m.newWithoutAssertion) return 'newWithoutAssertion';
  return 'neutral';
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'bench',
  GIT_AUTHOR_EMAIL: 'bench@testwitness.local',
  GIT_COMMITTER_NAME: 'bench',
  GIT_COMMITTER_EMAIL: 'bench@testwitness.local',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Buffered appender so 200 MB of XML does not go through one giant string. */
class Out {
  private fd: number;
  private buf: string[] = [];
  private size = 0;
  bytes = 0;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, 'w');
  }
  push(s: string): void {
    this.buf.push(s);
    this.size += s.length;
    if (this.size > 1 << 20) this.flush();
  }
  flush(): void {
    if (!this.buf.length) return;
    const b = Buffer.from(this.buf.join(''), 'utf8');
    writeSync(this.fd, b);
    this.bytes += b.length;
    this.buf = [];
    this.size = 0;
  }
  close(): number {
    this.flush();
    closeSync(this.fd);
    return this.bytes;
  }
}

const LOG_LEVELS = ['INFO ', 'DEBUG', 'WARN ', 'INFO ', 'INFO '];
const LOG_MSGS = ['processed order', 'cache miss for sku', 'retrying connection to warehouse', 'applied discount code', 'rounded total for invoice', 'loaded fixture rows', 'flushed ledger batch', 'validated payload for ticket'];

/** A deterministic pool of log lines; the XML padding is drawn from it. */
function logPool(r: () => number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const ms = String(int(r, 0, 999)).padStart(3, '0');
    out.push(`2026-01-01T00:00:${String(int(r, 0, 59)).padStart(2, '0')}.${ms} ${pick(r, LOG_LEVELS)} com.acme.${pick(r, PKGS)}.${cap(pick(r, NOUNS))} - ${pick(r, LOG_MSGS)} ${int(r, 1000, 999999)} in ${int(r, 1, 900)}ms`);
  }
  return out;
}

function padding(pool: string[], start: number, bytes: number): string {
  if (bytes <= 0) return '';
  const parts: string[] = [];
  let n = 0;
  let i = start;
  while (n < bytes) {
    const line = pool[i % pool.length]!;
    parts.push(line);
    n += line.length + 1;
    i++;
  }
  return parts.join('\n') + '\n';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

interface HeadFile {
  model: FileModel;
  tests: TestModel[];
}

function writeXml(junitDir: string, head: HeadFile[], xmlBytes: number, r: () => number): { files: number; bytes: number } {
  const pool = logPool(r, 512);
  const byLang = (l: Lang) => head.filter((h) => h.model.lang === l);
  const py = byLang('py');
  const ts = byLang('ts');
  const java = byLang('java');
  const cases = (hs: HeadFile[]) => hs.reduce((n, h) => n + h.tests.length, 0);
  const total = cases(head) || 1;
  const perCase = Math.floor(xmlBytes / total);
  let files = 0;
  let bytes = 0;
  let line = 0;

  // pytest: one file, system-out per testcase
  if (py.length) {
    const o = new Out(join(junitDir, 'pytest', 'junit.xml'));
    o.push(`<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="${cases(py)}" time="1.0" timestamp="2026-01-01T00:00:00.000000+00:00" hostname="runner">`);
    for (const h of py) {
      const rel = testPath(h.model);
      const cls = rel.replace(/\.py$/, '').replace(/\//g, '.');
      let ln = 6;
      for (const t of h.tests) {
        o.push(`<testcase classname="${cls}" name="${testName(t, 'py')}" file="${rel}" line="${ln}" time="0.00${int(r, 1, 9)}">`);
        if (t.skipped) o.push(`<skipped type="pytest.skip" message="unconditional skip" />`);
        o.push(`<system-out>${esc(padding(pool, line, perCase))}</system-out></testcase>`);
        line += 7;
        ln += 6;
      }
    }
    o.push(`</testsuite></testsuites>\n`);
    bytes += o.close();
    files++;
  }

  // jest-junit: one file, one testsuite per file, console output at suite level
  if (ts.length) {
    const o = new Out(join(junitDir, 'jest', 'junit.xml'));
    o.push(`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="jest tests" tests="${cases(ts)}" failures="0" errors="0" time="2.5">\n`);
    for (const h of ts) {
      const cls = className(h.model);
      o.push(`  <testsuite name="${cls}" errors="0" failures="0" skipped="${h.tests.filter((t) => t.skipped).length}" timestamp="2026-01-01T00:00:00" time="0.1" tests="${h.tests.length}">\n`);
      for (const t of h.tests) {
        const full = `${cls} ${testName(t, 'ts')}`;
        o.push(`    <testcase classname="${esc(full)}" name="${esc(full)}" time="0.00${int(r, 1, 9)}">\n`);
        if (t.skipped) o.push(`      <skipped/>\n`);
        o.push(`    </testcase>\n`);
      }
      o.push(`    <system-out><![CDATA[${padding(pool, line, perCase * h.tests.length)}]]></system-out>\n  </testsuite>\n`);
      line += 11;
    }
    o.push(`</testsuites>\n`);
    bytes += o.close();
    files++;
  }

  // Surefire: TEST-<class>.xml per class with properties and CDATA system-out per testcase
  for (const h of java) {
    const fq = `com.acme.${h.model.pkg}.${className(h.model)}Test`;
    const o = new Out(join(junitDir, 'surefire', `TEST-${fq}.xml`));
    o.push(`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://maven.apache.org/surefire/maven-surefire-plugin/xsd/surefire-test-report.xsd" version="3.0" name="${fq}" time="0.4" tests="${h.tests.length}" errors="0" skipped="${h.tests.filter((t) => t.skipped).length}" failures="0">\n`);
    o.push(`  <properties>\n`);
    o.push(`    <property name="java.version" value="21.0.4"/>\n    <property name="os.name" value="Linux"/>\n    <property name="user.dir" value="/home/runner/work/acme/acme"/>\n    <property name="surefire.real.class.path" value="/home/runner/work/acme/acme/target/surefire/surefirebooter.jar"/>\n`);
    o.push(`  </properties>\n`);
    for (const t of h.tests) {
      o.push(`  <testcase name="${testName(t, 'java')}" classname="${fq}" time="0.0${int(r, 10, 99)}">\n`);
      if (t.skipped) o.push(`    <skipped/>\n`);
      o.push(`    <system-out><![CDATA[${padding(pool, line, perCase)}]]></system-out>\n  </testcase>\n`);
      line += 5;
    }
    o.push(`</testsuite>\n`);
    bytes += o.close();
    files++;
  }
  return { files, bytes };
}

export function generate(opts: GenerateOptions): GenerateResult {
  const r = rng(opts.seed);
  const [minT, maxT] = opts.testsPerFile ?? [5, 30];
  rmSync(opts.dir, { recursive: true, force: true });
  const repo = join(opts.dir, 'repo');
  const junitDir = join(opts.dir, 'junit');
  mkdirSync(repo, { recursive: true });

  // Models. Test files first so the mutation kinds spread across all three languages (index mod 3).
  const testModels: FileModel[] = [];
  for (let i = 0; i < opts.testFiles; i++) {
    const lang = LANGS[i % 3]!;
    const tests: TestModel[] = [];
    const count = int(r, minT, maxT);
    const seen = new Set<string>();
    while (tests.length < count) {
      const words = [pick(r, VERBS), pick(r, NOUNS), pick(r, ['line', 'total', 'size', 'quantity', 'price', 'entry'])];
      const key = words.join(' ');
      if (seen.has(key)) {
        words.push(String(tests.length));
      }
      seen.add(words.join(' '));
      tests.push({ words, oracle: pick(r, ['equals', 'equals', 'equals', 'length', 'greater', 'throws'] as const), qty: int(r, 1, 9), price: int(r, 1, 50) });
    }
    testModels.push({ lang, pkg: PKGS[i % PKGS.length]!, noun: NOUNS[Math.floor(i / 3) % NOUNS.length]!, index: Math.floor(i / 60), tests });
  }
  const prodCount = Math.max(0, opts.files - opts.testFiles);
  const prodModels: FileModel[] = [];
  for (let i = 0; i < prodCount; i++) {
    const lang = LANGS[i % 3]!;
    // Production files for the first testFiles slots are the subjects of the tests; the rest are standalone.
    const src = testModels[i];
    if (src) prodModels.push({ ...src, tests: [] });
    else prodModels.push({ lang, pkg: PKGS[(i * 7) % PKGS.length]!, noun: NOUNS[(i * 3) % NOUNS.length]!, index: 1000 + i, tests: [] });
  }

  git(repo, ['init', '-q', '-b', 'main']);
  for (const f of testModels) write(repo, testPath(f), testSource(f, f.tests));
  for (const f of prodModels) write(repo, prodPath(f), prodSource(f, false));
  write(repo, 'README.md', '# acme\n\nBenchmark repository generated by testwitness bench/generate.ts.\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']).trim();

  const head: HeadFile[] = [];
  const counts = { ...opts.mutations, neutralTests: 0, production: prodModels.length };
  testModels.forEach((f, i) => {
    const kind = headKindFor(i, opts.mutations);
    if (kind === 'neutral') counts.neutralTests++;
    const tests = headTests(f, kind, r);
    head.push({ model: f, tests });
    write(repo, testPath(f), testSource(f, tests));
  });
  for (const f of prodModels) write(repo, prodPath(f), prodSource(f, true));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'head: touch every file\n\nGenerated by bench/generate.ts']);
  const headSha = git(repo, ['rev-parse', 'HEAD']).trim();

  const xml = writeXml(junitDir, head, opts.xmlBytes, r);
  return {
    repo,
    junitDir,
    junitGlob: `${junitDir}/**/*.xml`,
    baseSha,
    headSha,
    files: testModels.length + prodModels.length,
    testFiles: testModels.length,
    tests: head.reduce((n, h) => n + h.tests.length, 0),
    xmlFiles: xml.files,
    xmlBytes: xml.bytes,
    mutations: counts,
  };
}

export const LARGE: Omit<GenerateOptions, 'dir'> = {
  seed: 1,
  files: 1000,
  testFiles: 300,
  xmlBytes: 200 * 1024 * 1024,
  mutations: { deleted: 10, skipped: 10, loosened: 10, newWithoutAssertion: 20 },
};

export const SMALL: Omit<GenerateOptions, 'dir'> = {
  seed: 2,
  files: 20,
  testFiles: 6,
  xmlBytes: 2 * 1024 * 1024,
  mutations: { deleted: 1, skipped: 1, loosened: 1, newWithoutAssertion: 1 },
};
