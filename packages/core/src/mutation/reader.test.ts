import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyMutation, pitTestKey, readMutationFiles, readMutationString, sniffMutationFormat, toMutationEvidence } from './reader.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
/** Real StrykerJS 10.1.1 output, kept with the golden fixture that uses it. */
const STRYKER_REAL = readFileSync(join(root, 'fixtures/ts-vitest/cases/O001-mutation-upgrade-measured-weak/mutation/mutation.json'), 'utf8');

function stryker(files: Record<string, unknown[]>, extra: Record<string, unknown> = {}): string {
  const f = Object.fromEntries(Object.entries(files).map(([k, mutants]) => [k, { language: 'typescript', source: '', mutants }]));
  return JSON.stringify({ schemaVersion: '1.0', thresholds: { high: 80, low: 60 }, files: f, ...extra });
}
const m = (line: number, status: string, killedBy?: string[], coveredBy?: string[]) => ({ id: String(Math.random()), mutatorName: 'X', status, location: { start: { line, column: 1 }, end: { line, column: 2 } }, ...(killedBy ? { killedBy } : {}), ...(coveredBy ? { coveredBy } : {}) });

const J5 = (cls: string, method: string) => `demo.${cls}.[engine:junit-jupiter]/[class:demo.${cls}]/[method:${method}()]`;
function pit(rows: Array<{ status: string; line: number; cls?: string; file?: string; killing?: string; matrix?: { killing: string[]; succeeding: string[] } }>, prolog = ''): string {
  const body = rows
    .map(
      (r) =>
        `<mutation detected='${r.status === 'KILLED'}' status='${r.status}' numberOfTestsRun='1'><sourceFile>${r.file ?? 'Cart.java'}</sourceFile><mutatedClass>${r.cls ?? 'com.acme.Cart'}</mutatedClass><mutatedMethod>total</mutatedMethod><methodDescription>()I</methodDescription><lineNumber>${r.line}</lineNumber><mutator>org.pitest.mutationtest.engine.gregor.mutators.MathMutator</mutator><indexes><index>1</index></indexes><blocks><block>0</block></blocks>${r.killing !== undefined ? `<killingTest>${r.killing}</killingTest>` : '<killingTest/>'}${r.matrix ? `<killingTests>${r.matrix.killing.join('|')}</killingTests><succeedingTests>${r.matrix.succeeding.join('|')}</succeedingTests>` : ''}<description>Replaced integer addition with subtraction</description></mutation>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>${prolog}\n<mutations partial="true">\n${body}\n</mutations>\n`;
}

describe('mutation report sniffing', () => {
  it('tells Stryker JSON, PIT XML and mutmut files apart', () => {
    expect(sniffMutationFormat(STRYKER_REAL)).toBe('stryker');
    expect(sniffMutationFormat(pit([]))).toBe('pit');
    expect(sniffMutationFormat('{"exit_code_by_key": {"a.x_f__mutmut_1": 1}}')).toBe('mutmut');
    expect(sniffMutationFormat('{"killed": 3, "survived": 4, "total": 7, "no_tests": 0}')).toBe('mutmut');
    expect(sniffMutationFormat('<coverage/>')).toBeUndefined();
    expect(sniffMutationFormat('{"name": "x"}')).toBeUndefined();
  });
});

describe('Stryker JSON reader', () => {
  it('reads real StrykerJS output: per line outcomes, killing and covering test keys, and the test list', async () => {
    const ev = toMutationEvidence(await readMutationString(STRYKER_REAL, 'mutation.json'));
    expect(ev).toMatchObject({ tools: ['stryker'], files: 1, mutants: 8, killed: 2, survived: 6, noCoverage: 0, testIds: true });
    expect([...ev.tests!].sort()).toEqual(['tax::charges twenty percent', 'tax::handles an exemption']);
    expect([...ev.killers]).toEqual(['tax::charges twenty percent']);
    const tax = ev.lookup('src/tax.ts')!;
    expect(tax.lines.get(6)).toMatchObject({ total: 5, killed: 0, survived: 5, noCoverage: 0 }); // four on the condition, one for the block that opens on the line
    expect([...tax.lines.get(6)!.coveredBy]).toEqual(['tax::handles an exemption']);
    expect(tax.lines.get(2)).toMatchObject({ total: 1, killed: 1 });
    expect([...tax.lines.get(2)!.killedBy]).toEqual(['tax::charges twenty percent']);
    expect(ev.warnings).toEqual([]);
  });

  it('counts timeouts as killed and leaves compile errors, runtime errors, ignored and pending mutants out', async () => {
    const text = stryker({ 'src/a.ts': [m(1, 'Timeout'), m(1, 'CompileError'), m(2, 'RuntimeError'), m(2, 'Ignored'), m(3, 'Pending'), m(3, 'NoCoverage')] });
    const ev = toMutationEvidence(await readMutationString(text));
    expect(ev).toMatchObject({ mutants: 2, killed: 1, survived: 0, noCoverage: 1 });
    expect([...ev.lookup('src/a.ts')!.lines.keys()].sort()).toEqual([1, 3]);
  });

  it('ignores killedBy ids that testFiles does not define, and says M002 is silent when no test can be named', async () => {
    const ev = toMutationEvidence(await readMutationString(stryker({ 'src/a.ts': [m(1, 'Killed', ['7'], ['7'])] })));
    expect(ev.testIds).toBe(false);
    expect(ev.killers.size).toBe(0);
    expect(ev.tests).toBeUndefined();
    expect(ev.warnings.join(' ')).toMatch(/name no killing tests, so M002 is silent/);
  });

  it('normalises describe chains with either separator, and keys test files given as class names', async () => {
    const text = stryker(
      { 'src/cart.ts': [m(4, 'Killed', ['a', 'b'])] },
      {
        testFiles: {
          'src/cart.test.ts': { tests: [{ id: 'a', name: 'Cart > total > sums' }] },
          'Acme.Cart.CartTests': { tests: [{ id: 'b', name: 'Sums' }] },
        },
      },
    );
    const ev = toMutationEvidence(await readMutationString(text));
    expect([...ev.killers].sort()).toEqual(['cart::cart total sums', 'carttests::sums']);
  });

  it('makes paths relative through a projectRoot inside the repository, and matches other paths by suffix', async () => {
    const text = stryker({ 'src/cart.ts': [m(1, 'Survived')], '/ci/work/app/lib/util.ts': [m(2, 'Survived')] }, { projectRoot: '/repo/packages/shop' });
    const ev = toMutationEvidence(await readMutationString(text, 'r.json', '/repo'));
    expect(ev.lookup('packages/shop/src/cart.ts')).toBeDefined();
    expect(ev.lookup('src/cart.ts')).toBeDefined(); // suffix of the stored path
    expect(ev.lookup('lib/util.ts')).toBeDefined();
    expect(ev.lookup('other/util.ts')).toBeUndefined();
  });

  it('makes paths relative through a Windows projectRoot with backslashes and another drive letter case', async () => {
    const text = stryker({ 'src\\cart.ts': [m(1, 'Survived')], 'C:\\a\\app\\packages\\shop\\src\\tax.ts': [m(2, 'Survived')] }, { projectRoot: 'C:\\a\\app\\packages\\shop' });
    const data = await readMutationString(text.replace(/\n/g, '\r\n'), 'r.json', 'c:\\a\\app');
    expect([...data.files.keys()].sort()).toEqual(['packages/shop/src/cart.ts', 'packages/shop/src/tax.ts']);
    const ev = toMutationEvidence(data);
    expect(ev.lookup('packages/shop/src/cart.ts')).toBeDefined();
    expect(ev.lookup('packages/shop/src/tax.ts')).toBeDefined();
  });

  it('reads a PIT report written with CRLF line endings', async () => {
    const lf = toMutationEvidence(await readMutationString(pit([{ status: 'SURVIVED', line: 4 }, { status: 'KILLED', line: 5, killing: J5('CartTest', 'total') }]), 'mutations.xml'));
    const crlf = toMutationEvidence(await readMutationString(pit([{ status: 'SURVIVED', line: 4 }, { status: 'KILLED', line: 5, killing: J5('CartTest', 'total') }]).replace(/\n/g, '\r\n'), 'mutations.xml'));
    expect(crlf.mutants).toBe(lf.mutants);
    expect(crlf.lookup('src/main/java/com/acme/Cart.java')).toEqual(lf.lookup('src/main/java/com/acme/Cart.java'));
    expect([...crlf.killers]).toEqual([...lf.killers]);
  });

  it('reports a file that is not a Stryker report, or not JSON, as a warning', async () => {
    const bad = toMutationEvidence(await readMutationString('{"files": 3, "schemaVersion": "1"}', 'bad.json'));
    expect(bad.sources).toEqual([]);
    expect(bad.warnings[0]).toMatch(/not a Stryker mutation report/);
    const data = emptyMutation();
    await readMutationString('{"schemaVersion": "1", "files": {', 'trunc.json', undefined, data);
    expect(data.warnings[0]).toMatch(/not valid JSON/);
    const empty = await readMutationString(stryker({}), 'empty.json');
    expect(empty.warnings[0]).toMatch(/no killed, survived or uncovered mutants/);
  });
});

describe('PIT mutations.xml reader', () => {
  it('reads outcomes per line, maps the package to a path and keys JUnit 5 killing tests', async () => {
    const text = pit([
      { status: 'KILLED', line: 10, killing: J5('CartTest', 'sums') },
      { status: 'TIMED_OUT', line: 10 },
      { status: 'SURVIVED', line: 11 },
      { status: 'NO_COVERAGE', line: 12 },
      { status: 'RUN_ERROR', line: 13 },
      { status: 'NON_VIABLE', line: 13 },
      { status: 'KILLED', line: 20, cls: 'com.acme.Cart$Line', killing: J5('CartTest', 'lines') },
    ]);
    const ev = toMutationEvidence(await readMutationString(text, 'mutations.xml'));
    expect(ev).toMatchObject({ tools: ['pit'], files: 1, mutants: 5, killed: 3, survived: 1, noCoverage: 1, testIds: true });
    const cart = ev.lookup('src/main/java/com/acme/Cart.java')!;
    expect(cart.lines.get(10)).toMatchObject({ total: 2, killed: 2 });
    expect(cart.lines.has(13)).toBe(false);
    expect([...ev.killers].sort()).toEqual(['carttest::lines', 'carttest::sums']);
    // Without fullMutationMatrix PIT records no covering tests.
    expect(cart.lines.get(10)!.coveredBy.size).toBe(0);
    expect(ev.tests).toBeUndefined();
  });

  it('reads killingTests and succeedingTests of a full mutation matrix as killing and covering tests', async () => {
    const text = pit([{ status: 'KILLED', line: 3, killing: J5('CartTest', 'a'), matrix: { killing: [J5('CartTest', 'a'), J5('CartTest', 'b')], succeeding: [J5('CartTest', 'c')] } }]);
    const ev = toMutationEvidence(await readMutationString(text));
    const l = ev.lookup('com/acme/Cart.java')!.lines.get(3)!;
    expect([...l.killedBy].sort()).toEqual(['carttest::a', 'carttest::b']);
    expect([...l.coveredBy].sort()).toEqual(['carttest::a', 'carttest::b', 'carttest::c']);
  });

  it('says M002 is silent when no mutation names a killing test', async () => {
    const ev = toMutationEvidence(await readMutationString(pit([{ status: 'KILLED', line: 3, killing: '' }, { status: 'SURVIVED', line: 4 }])));
    expect(ev.testIds).toBe(false);
    expect(ev.warnings.join(' ')).toMatch(/M002 is silent/);
  });

  it('never resolves a DOCTYPE or external entity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-pit-xxe-'));
    try {
      writeFileSync(join(dir, 'secret.txt'), 'SECRET');
      const text = pit([{ status: 'SURVIVED', line: 1, file: '&xxe;' }], `<!DOCTYPE mutations [<!ENTITY xxe SYSTEM "file://${join(dir, 'secret.txt')}">]>`);
      const data = await readMutationString(text);
      expect([...data.files.keys()].join()).not.toContain('SECRET');
      expect(data.warnings.join(' ')).not.toContain('SECRET');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on an XML file that is not a PIT report and on an empty report', async () => {
    const data = emptyMutation();
    await readMutationString('<mutations partial="false"></mutations>', 'empty.xml', undefined, data);
    expect(data.warnings[0]).toMatch(/no killed, survived or uncovered mutations/);
    const other = await readMutationString('<report/>', 'jacoco.xml');
    expect(other.warnings[0]).toMatch(/not a Stryker JSON or PIT mutations.xml report/);
  });
});

describe('PIT test names', () => {
  it('keys JUnit 5 unique ids, nested classes and parameterised templates like the JUnit reader', () => {
    expect(pitTestKey(J5('CartTest', 'sums'))).toBe('carttest::sums');
    expect(pitTestKey('com.acme.CartTest.[engine:junit-jupiter]/[class:com.acme.CartTest]/[nested-class:Empty]/[method:isZero()]')).toBe('carttest$empty::iszero');
    expect(pitTestKey('com.acme.CartTest.[engine:junit-jupiter]/[class:com.acme.CartTest]/[test-template:adds(int, int)]/[test-template-invocation:#2]')).toBe('carttest::adds');
    expect(pitTestKey('com.acme.CartTest.[engine:junit-jupiter]/[class:com.acme.CartTest]')).toBeUndefined();
  });
  it('keys JUnit 4 and plain dotted names', () => {
    expect(pitTestKey('com.acme.CartTest.sums(com.acme.CartTest)')).toBe('carttest::sums');
    expect(pitTestKey('com.acme.CartTest.sums')).toBe('carttest::sums');
    expect(pitTestKey('  ')).toBeUndefined();
    expect(pitTestKey('sums')).toBeUndefined();
  });
});

describe('reading mutation reports from disk', () => {
  it('reads both formats, skips mutmut files with a note, and keeps to the file and byte caps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-mut-'));
    try {
      const files = ['a.json', 'b.xml', 'c.meta', 'd.json'].map((f) => join(dir, f));
      writeFileSync(files[0]!, STRYKER_REAL);
      writeFileSync(files[1]!, pit([{ status: 'SURVIVED', line: 2 }]));
      writeFileSync(files[2]!, '{\n  "exit_code_by_key": {}\n}');
      writeFileSync(files[3]!, '{"name": "not a report"}');
      const all = await readMutationFiles(files, dir);
      expect(all.sources).toEqual([files[0], files[1]]);
      expect([...all.tools].sort()).toEqual(['pit', 'stryker']);
      expect(all.warnings.some((w) => w.includes('c.meta') && w.includes('mutmut results carry no line numbers'))).toBe(true);
      expect(all.warnings.some((w) => w.includes('d.json') && w.includes('not a Stryker JSON'))).toBe(true);
      const capped = await readMutationFiles(files.slice(0, 2), dir, { maxFiles: 1 });
      expect(capped.capped).toBe(true);
      expect(capped.sources).toEqual([files[0]]);
      const small = await readMutationFiles(files.slice(0, 2), dir, { maxBytes: 2000 });
      expect(small.sources).toEqual([files[1]]);
      expect(small.warnings[0]).toMatch(/would pass the 0 MB cap/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
