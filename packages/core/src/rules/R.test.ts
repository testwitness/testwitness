import { describe, expect, it } from 'vitest';
import { R001, R002, R003, R004, R005, R006, R010 } from './R.js';
import { changedFile, context, inventory, test as t } from './testkit.js';
import { definedSymbols, isNearDuplicate, minimumVersionRaised, testTokens } from './util.js';
import type { ChangedFile } from '../types.js';

const P = 'src/billing.test.ts';

describe('R001 test deleted', () => {
  it('reports a deleted test as medium, high when the PR touched the production file', async () => {
    const a = t({ name: 'a', body: 'expect(charge(1)).toBe(2)' });
    const b = t({ name: 'b', body: 'expect(2).toBe(2)' });
    const pair = { file: changedFile(P), base: inventory(P, [a, b]), head: inventory(P, [b]) };
    const medium = await R001.run(context({ pairs: [pair] }), {});
    expect(medium).toHaveLength(1);
    expect(medium[0]).toMatchObject({ ruleId: 'R001', severity: 'medium', subject: 'a' });
    const high = await R001.run(context({ pairs: [pair], changedProduction: ['src/billing.ts'] }), {});
    expect(high[0]!.severity).toBe('high');
  });

  it('does not report a renamed test with the same body', async () => {
    const a = t({ name: 'old name', body: 'expect(charge(1)).toBe(2)' });
    const a2 = t({ name: 'new name', body: 'expect(charge(1)).toBe(2)' });
    const pair = { file: changedFile(P), base: inventory(P, [a]), head: inventory(P, [a2]) };
    expect(await R001.run(context({ pairs: [pair] }), {})).toEqual([]);
  });

  it('reports a test moved to another file as low with label moved', async () => {
    const a = t({ name: 'a', body: 'expect(charge(1)).toBe(2)' });
    const pair = { file: changedFile(P), base: inventory(P, [a]), head: inventory(P, []) };
    const other = inventory('src/other.test.ts', [t({ name: 'a', body: 'expect(charge(1)).toBe(2)' })]);
    const out = await R001.run(context({ pairs: [pair], headTree: { 'src/other.test.ts': other } }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'low', label: 'moved' });
    expect(out[0]!.message).toContain('src/other.test.ts');
  });

  it('reports tests folded into a parameterised test as low', async () => {
    const a = t({ name: 'adds one', body: 'expect(add(1,1)).toBe(2)' });
    const b = t({ name: 'adds two', body: 'expect(add(2,2)).toBe(4)' });
    const keep = t({ name: 'adds', body: 'expect(add(x,y)).toBe(z)', parameterCount: 1 });
    const folded = t({ name: 'adds', body: 'expect(add(x,y)).toBe(z)', parameterCount: 3 });
    const pair = { file: changedFile(P), base: inventory(P, [a, b, keep]), head: inventory(P, [folded]) };
    const out = await R001.run(context({ pairs: [pair] }), {});
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.severity === 'low' && f.label === 'parameterised')).toBe(true);
  });

  it('still reports when the fold does not cover all deleted tests', async () => {
    const a = t({ name: 'adds one', body: 'expect(add(1,1)).toBe(2)' });
    const b = t({ name: 'adds two', body: 'expect(add(2,2)).toBe(4)' });
    const c = t({ name: 'adds three', body: 'expect(add(3,3)).toBe(6)' });
    const folded = t({ name: 'adds', body: 'expect(add(x,y)).toBe(z)', parameterCount: 2 });
    const pair = { file: changedFile(P), base: inventory(P, [a, b, c]), head: inventory(P, [folded]) };
    const out = await R001.run(context({ pairs: [pair] }), {});
    expect(out.every((f) => f.severity === 'medium')).toBe(true);
  });

  it('leaves deleted files to R002', async () => {
    const a = t({ name: 'a' });
    const pair = { file: changedFile(P, 'deleted'), base: inventory(P, [a]) };
    expect(await R001.run(context({ pairs: [pair] }), {})).toEqual([]);
  });
});

describe('R002 test file deleted', () => {
  it('reports the number of tests lost', async () => {
    const pair = { file: changedFile(P, 'deleted'), base: inventory(P, [t({ name: 'a', body: 'x' }), t({ name: 'b', body: 'y' })]) };
    const out = await R002.run(context({ pairs: [pair] }), {});
    expect(out[0]).toMatchObject({ severity: 'high', message: 'Test file deleted with 2 tests not found elsewhere' });
  });
  it('reports low moved when every test reappears elsewhere', async () => {
    const pair = { file: changedFile(P, 'deleted'), base: inventory(P, [t({ name: 'a', body: 'x' }), t({ name: 'b', body: 'y' })]) };
    const dest = inventory('src/new.test.ts', [t({ name: 'a', body: 'x' }), t({ name: 'b2', body: 'y' })]);
    const out = await R002.run(context({ pairs: [pair], headTree: { 'src/new.test.ts': dest } }), {});
    expect(out[0]).toMatchObject({ severity: 'low', label: 'moved' });
  });
  it('reports low moved when the same test names reappear in a file with the same name elsewhere, not in another file', async () => {
    const J = 'src/test/java/test/a/Test1.java';
    const pair = { file: changedFile(J, 'deleted', 'java'), base: inventory(J, [t({ name: 'test', container: ['Test1'], body: 'x' })]) };
    const same = inventory('src/test/java/org/x/a/Test1.java', [t({ name: 'test', container: ['Test1'], body: 'other' })]);
    expect(await R002.run(context({ pairs: [pair], headTree: { 'src/test/java/org/x/a/Test1.java': same } }), {})).toMatchObject([{ severity: 'low', label: 'moved' }]);
    const other = inventory('src/test/java/org/x/a/Test2.java', [t({ name: 'test', container: ['Test2'], body: 'other' })]);
    expect(await R002.run(context({ pairs: [pair], headTree: { 'src/test/java/org/x/a/Test2.java': other } }), {})).toMatchObject([{ severity: 'high' }]);
  });
  it('reports low rewritten when new files in the same directory add at least as many tests', async () => {
    const pair = { file: changedFile('tests/a.spec.ts', 'deleted'), base: inventory('tests/a.spec.ts', [t({ name: 'a', body: 'x' })]) };
    const fresh = { file: changedFile('tests/b.spec.ts', 'added'), head: inventory('tests/b.spec.ts', [t({ name: 'b', body: 'y' })]) };
    expect(await R002.run(context({ pairs: [pair, fresh] }), {})).toMatchObject([{ severity: 'low', label: 'rewritten' }]);
    const elsewhere = { file: changedFile('other/b.spec.ts', 'added'), head: inventory('other/b.spec.ts', [t({ name: 'b', body: 'y' })]) };
    expect(await R002.run(context({ pairs: [pair, elsewhere] }), {})).toMatchObject([{ severity: 'high' }]);
  });
  it('ignores deleted files with no tests', async () => {
    const pair = { file: changedFile(P, 'deleted'), base: inventory(P, []) };
    expect(await R002.run(context({ pairs: [pair] }), {})).toEqual([]);
  });
});

describe('R003 newly skipped', () => {
  const base = t({ name: 'a', body: 'x' });
  it('reports a new unconditional skip as medium, high if production touched, lowered with an issue reference', async () => {
    const head = t({ name: 'a', body: 'x', markers: [{ marker: 'it.skip', kind: 'skip', constant: true }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
    expect((await R003.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'medium' });
    expect((await R003.run(context({ pairs: [pair], changedProduction: ['src/billing.ts'] }), {}))[0]).toMatchObject({ severity: 'high' });
    const tracked = t({ name: 'a', body: 'x', markers: [{ marker: 'it.skip', kind: 'skip', constant: true, reason: 'flaky, see #123' }] });
    const pair2 = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [tracked]) };
    expect((await R003.run(context({ pairs: [pair2] }), {}))[0]).toMatchObject({ severity: 'low', label: 'tracked' });
  });
  it('reports a conditional skip as low and ignores an existing skip', async () => {
    const cond = t({ name: 'a', body: 'x', markers: [{ marker: 'pytest.mark.skipif', kind: 'conditional-skip', constant: false }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [cond]) };
    expect((await R003.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'low', label: 'conditional' });
    const already = t({ name: 'a', body: 'x', markers: [{ marker: 'it.skip', kind: 'skip', constant: true }] });
    const pair2 = { file: changedFile(P), base: inventory(P, [already]), head: inventory(P, [already]) };
    expect(await R003.run(context({ pairs: [pair2] }), {})).toEqual([]);
  });
  it('ignores a skip whose condition folded to false', async () => {
    const cond = t({ name: 'a', body: 'x', markers: [{ marker: 'skipif', kind: 'skip', constant: false }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [cond]) };
    expect(await R003.run(context({ pairs: [pair] }), {})).toEqual([]);
  });
});

describe('R004 xfail', () => {
  it('reports a new xfail as high, medium when strict with an issue reference', async () => {
    const base = t({ name: 'a', body: 'x' });
    const x = t({ name: 'a', body: 'x', markers: [{ marker: 'pytest.mark.xfail', kind: 'xfail', constant: true, reason: 'bug' }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [x]) };
    expect((await R004.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'high' });
    const strict = t({ name: 'a', body: 'x', markers: [{ marker: 'pytest.mark.xfail(strict=True)', kind: 'xfail', constant: true, reason: 'PAY-412' }] });
    const pair2 = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [strict]) };
    expect((await R004.run(context({ pairs: [pair2] }), {}))[0]).toMatchObject({ severity: 'medium' });
  });
});

describe('R005 focused', () => {
  it('reports .only on modified and added tests but not pre existing focus', async () => {
    const base = t({ name: 'a', body: 'x' });
    const only = t({ name: 'a', body: 'x', markers: [{ marker: 'it.only', kind: 'focus' }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [only]) };
    expect((await R005.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'high', subject: 'a' });
    const added = { file: changedFile(P, 'added'), head: inventory(P, [only]) };
    expect(await R005.run(context({ pairs: [added] }), {})).toHaveLength(1);
    const pre = { file: changedFile(P), base: inventory(P, [only]), head: inventory(P, [only]) };
    expect(await R005.run(context({ pairs: [pre] }), {})).toEqual([]);
  });
});

describe('R006 emptied', () => {
  it('reports a body going from statements to none, not when skipped, not when already empty', async () => {
    const base = t({ name: 'a', body: 'a(); b();', statements: 2, assertions: [{ callee: 'expect.toBe' }] });
    const empty = t({ name: 'a', body: 'pass', statements: 0 });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [empty]) };
    const out = await R006.run(context({ pairs: [pair] }), {});
    expect(out[0]).toMatchObject({ severity: 'high', before: '2 statements, 1 assertions' });
    const skipped = t({ name: 'a', body: 'pass', statements: 0, markers: [{ marker: 'skip', kind: 'skip', constant: true }] });
    expect(await R006.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [skipped]) }] }), {})).toEqual([]);
    expect(await R006.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [empty]), head: inventory(P, [empty]) }] }), {})).toEqual([]);
  });
});

describe('R010 added then skipped', () => {
  it('reports low, medium when the PR claims tests were added', async () => {
    const fix = t({ name: 'a', body: 'x', markers: [{ marker: 'test.fixme', kind: 'fixme', constant: true }] });
    const pair = { file: changedFile(P, 'added'), head: inventory(P, [fix]) };
    expect((await R010.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'low' });
    expect((await R010.run(context({ pairs: [pair], prText: { title: 'Add tests for 3DS', body: '' } }), {}))[0]).toMatchObject({ severity: 'medium' });
  });
});

describe('overrides and conditional xfail', () => {
  it('R003 reports an added skipped override only test as medium with label override; R010 and O001 stay quiet', async () => {
    const { O001 } = await import('./O.js');
    const t2 = { ...t({ name: 'adds', container: ['CartTest'], body: 'super.adds();', markers: [{ marker: '@Disabled', kind: 'skip' as const, constant: true }] }), overrideOnly: true };
    const sibling = t({ name: 'other', container: ['CartTest'], body: 'x' });
    const pair = { file: changedFile(P), base: inventory(P, [sibling]), head: inventory(P, [sibling, t2]) };
    expect((await R003.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'medium', label: 'override' });
    expect(await R010.run(context({ pairs: [pair] }), {})).toEqual([]);
    // In a brand new class the override is a test added then skipped (R010 low), not a conversion.
    const fresh = { file: changedFile(P, 'added'), head: inventory(P, [t2]) };
    expect(await R003.run(context({ pairs: [fresh] }), {})).toEqual([]);
    expect((await R010.run(context({ pairs: [fresh] }), {}))[0]).toMatchObject({ severity: 'low' });
    const plain = { ...t({ name: 'b', container: ['CartTest'], body: 'super.b();' }), overrideOnly: true };
    expect(await O001.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [plain]) }] }), {})).toEqual([]);
  });
  it('R004 reports conditional xfail low, per case marks medium, overrides high', async () => {
    const base = t({ name: 'a', body: 'x' });
    const cond = t({ name: 'a', body: 'x', markers: [{ marker: 'pytest.mark.xfail', kind: 'xfail', constant: false }] });
    expect((await R004.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [cond]) }] }), {}))[0]).toMatchObject({ severity: 'low', label: 'conditional' });
    const perCase = t({ name: 'a', body: 'x', markers: [{ marker: 'pytest.param(marks=pytest.mark.xfail)', kind: 'xfail', constant: true }] });
    expect((await R004.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [perCase]) }] }), {}))[0]).toMatchObject({ severity: 'medium', label: 'one case' });
    const over = { ...t({ name: 'c', body: 'super().c()', markers: [{ marker: 'pytest.mark.xfail', kind: 'xfail' as const, constant: true }] }), overrideOnly: true };
    const sib = t({ name: 'd', body: 'y' });
    expect((await R004.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [sib]), head: inventory(P, [sib, over]) }] }), {}))[0]).toMatchObject({ severity: 'high', label: 'override' });
    expect(await R004.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [over]) }] }), {})).toEqual([]);
  });
});

describe('production symbols removed and version gates', () => {
  it('reads classes and functions per language', () => {
    expect([...definedSymbols('class Folder:\n    def render(self):\n        pass\n\ndef build():\n    pass\n', 'python')].sort()).toEqual(['Folder', 'build']);
    expect([...definedSymbols('public class Cart {\n  public static int total(int a) { return a; }\n}\n', 'java')].sort()).toEqual(['Cart', 'total']);
    expect([...definedSymbols('export function price() {}\nexport class Cart {}\nfunction help() {}\n', 'typescript')].sort()).toEqual(['Cart', 'help', 'price']);
  });
  it('reports a deleted test of a class removed from a production file that stays as low production removed', async () => {
    const T = 'pkg/test/test_script.py';
    const deleted = t({ name: 'test_render', container: ['DirectoryTests'], body: 'x', line: 3 });
    const kept = t({ name: 'test_ok', body: 'y', line: 1 });
    const pair = { file: changedFile(T, 'modified', 'python'), base: inventory(T, [kept, deleted]), head: inventory(T, [kept]) };
    const prod: ChangedFile = { ...changedFile('pkg/script.py', 'modified', 'python'), kind: 'production' };
    const ctx = { ...context({ pairs: [pair], files: [prod] }) };
    const sources: Record<string, [string, string]> = {
      'pkg/script.py': ['class Script:\n    pass\n\nclass Directory:\n    pass\n', 'class Script:\n    pass\n'],
      [T]: ['def test_ok():\n    assert 1\nclass DirectoryTests:\n    def test_render(self):\n        assert Directory()\n', ''],
    };
    ctx.readBase = async (p) => sources[p]?.[0];
    ctx.readHead = async (p) => sources[p]?.[1];
    expect(await R001.run(ctx, {})).toMatchObject([{ severity: 'low', label: 'production removed' }]);
  });
  /** A run of R001 over one test file and one production file with given base and head sources. */
  const removalRun = async (spec: { testBase: string; testHead: string; prod: Record<string, [string | undefined, string | undefined]>; deleted: ReturnType<typeof t>; kept: ReturnType<typeof t> }) => {
    const T = 'src/ledger.test.ts';
    const pair = { file: changedFile(T), base: inventory(T, [spec.kept, spec.deleted]), head: inventory(T, [spec.kept]) };
    const prod = Object.entries(spec.prod).map(([p, [b, h]]): ChangedFile => ({ ...changedFile(p, b === undefined ? 'added' : h === undefined ? 'deleted' : 'modified'), kind: 'production' }));
    const ctx = context({ pairs: [pair], files: prod, changedProduction: Object.keys(spec.prod) });
    const sources: Record<string, [string | undefined, string | undefined]> = { ...spec.prod, [T]: [spec.testBase, spec.testHead] };
    ctx.readBase = async (p) => sources[p]?.[0];
    ctx.readHead = async (p) => sources[p]?.[1];
    return R001.run(ctx, {});
  };
  const ledgerBase = 'export function createLedger() {\n  return {\n    add(n: number) { return n; },\n    settle(id: string) { return id; },\n  };\n}\n';
  const ledgerHead = 'export function createLedger() {\n  return {\n    add(n: number) { return n; },\n  };\n}\n';
  const testBase = [
    "test('adds', () => {",
    '  expect(createLedger().add(1)).toBe(1)',
    '})',
    "test('settles', () => {",
    '  const ledger = createLedger()',
    "  expect(ledger.settle('a')).toBe('a')",
    '})',
  ].join('\n');
  const testHead = testBase.split('\n').slice(0, 3).join('\n');
  const kept = t({ name: 'adds', body: 'k', line: 1 });
  const deleted = t({ name: 'settles', body: 'd', line: 4 });

  it('reports a deleted test of an object method this PR removed as low production removed', async () => {
    const out = await removalRun({ testBase, testHead, prod: { 'src/ledger.ts': [ledgerBase, ledgerHead] }, deleted, kept });
    expect(out).toMatchObject([{ severity: 'low', label: 'production removed' }]);
    expect(out[0]!.message).toContain('settle');
  });

  it('still reports the deleted test when the method it called stays in the production code', async () => {
    const out = await removalRun({ testBase, testHead, prod: { 'src/ledger.ts': [ledgerBase, ledgerBase.replace('return id;', 'return id.trim();')] }, deleted, kept });
    expect(out).toMatchObject([{ severity: 'high' }]);
  });

  it('reports a deleted test of a module this PR deletes as low production removed, and not when the module stays', async () => {
    const base = `import { legacyTotal } from './legacy-total';\n${testBase.replace("ledger.settle('a')", 'legacyTotal(ledger)')}`;
    const head = testHead;
    const gone = await removalRun({ testBase: base, testHead: head, prod: { 'src/legacy-total.ts': ['export const legacyTotal = (l: unknown) => l;\n', undefined] }, deleted: t({ name: 'settles', body: 'd', line: 5 }), kept: t({ name: 'adds', body: 'k', line: 2 }) });
    expect(gone).toMatchObject([{ severity: 'low', label: 'production removed' }]);
    const stays = await removalRun({ testBase: base, testHead: head, prod: { 'src/legacy-total.ts': ['export const legacyTotal = (l: unknown) => l;\n', 'export const legacyTotal = (l: unknown) => l ?? 0;\n'] }, deleted: t({ name: 'settles', body: 'd', line: 5 }), kept: t({ name: 'adds', body: 'k', line: 2 }) });
    expect(stays).toHaveLength(1);
    expect(stays[0]!.label).toBeUndefined();
    expect(stays[0]!.severity).not.toBe('low');
  });

  it('reads a class commented out line by line as removed', () => {
    expect([...definedSymbols('// class Folder {\n//   render() {}\n// }\nexport class Cart {}\n', 'typescript')]).toEqual(['Cart']);
    expect([...definedSymbols('# class Folder:\n#     pass\nclass Cart:\n    pass\n', 'python')]).toEqual(['Cart']);
  });

  it('sees a raised minimum version only when the number goes up', () => {
    const cfg = (before: string, after: string): ChangedFile => ({ ...changedFile('pyproject.toml'), kind: 'runner-config', hunks: [{ baseStart: 1, baseCount: 1, headStart: 1, headCount: 1, removed: [before], added: [after] }] });
    expect(minimumVersionRaised(context({ pairs: [], files: [cfg('requires-python = ">=3.10"', 'requires-python = ">=3.11"')] }))).toBe(true);
    expect(minimumVersionRaised(context({ pairs: [], files: [cfg('requires-python = ">=3.11"', 'requires-python = ">=3.10"')] }))).toBe(false);
    expect(minimumVersionRaised(context({ pairs: [], files: [cfg('    "node": ">=18"', '    "node": ">=20"')] }))).toBe(true);
  });
});


describe('R001 near duplicate removed', () => {
  const kept = [
    "  it('keeps the header with a charset', function () {",
    '    const res = send({ type: "text/csv" });',
    "    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');",
    "    expect(res.status).toBe(200);",
    "    expect(res.body).toBe('a,b');",
    '  });',
  ];
  const copy = [
    "  it('keeps the header', function () {",
    "    // same request as above",
    "    const res = send({ type: 'text/csv' })",
    "    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')",
    "    expect(res.status).toBe(200)",
    '  });',
  ];
  const other = copy.map((l) => l.replace('200', '201'));
  const run = async (deleted: string[]) => {
    const keptTest = t({ name: 'keeps the header with a charset', body: 'k', line: 1 });
    keptTest.endLine = 6;
    const gone = t({ name: 'keeps the header', body: 'd', line: 7 });
    gone.endLine = 12;
    const pair = { file: changedFile(P), base: inventory(P, [keptTest, gone]), head: inventory(P, [keptTest]) };
    const ctx = { ...context({ pairs: [pair] }), readBase: async () => [...kept, ...deleted].join('\n'), readHead: async () => kept.join('\n') };
    return R001.run(ctx, {});
  };

  it('reports low when a test that stays contains the deleted one token for token', async () => {
    expect(await run(copy)).toMatchObject([{ severity: 'low', label: 'near duplicate removed', subject: 'keeps the header' }]);
  });

  it('still reports medium when the deleted test differs in a value', async () => {
    const out = await run(other);
    expect(out).toMatchObject([{ severity: 'medium', subject: 'keeps the header' }]);
    expect(out[0]!.label).toBeUndefined();
  });

  it('tokenises without whitespace, comments, semicolons, quote style or the test name', () => {
    expect(testTokens("it('n', () => { f(\"a\"); // c\n})", 'typescript', 'n')).toEqual(['it', '(', ',', '(', ')', '=', '>', '{', 'f', '(', '"a', ')', '}', ')']);
    expect(testTokens("def test_n():\n    assert f('a')  # c", 'python', 'test_n')).toEqual(['def', '(', ')', ':', 'assert', 'f', '(', '"a', ')']);
  });

  it('needs every token in order, one case only literal at most, and a kept test at most half as long again', () => {
    const base = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(isNearDuplicate(base, [...base])).toBe(true);
    expect(isNearDuplicate(base.slice(0, 20), base.slice(0, 20))).toBe(false); // too short to tell
    expect(isNearDuplicate(base, [...base.slice(0, 29), 't99'])).toBe(false); // one identifier differs
    expect(isNearDuplicate(base, [...base, ...Array.from({ length: 16 }, (_, i) => `x${i}`)])).toBe(false); // kept test far longer
    const lit = [...base.slice(0, 28), '"Content-Type', '"Accept'];
    expect(isNearDuplicate(lit, [...base.slice(0, 28), '"content-type', '"Accept'])).toBe(true);
    expect(isNearDuplicate(lit, [...base.slice(0, 28), '"content-type', '"accept'])).toBe(false);
  });

  it('accepts added checks in the kept test, not added input', () => {
    const base = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const withCheck = [...base.slice(0, 15), '.', 'expect', '(', 'res', '.', 'ok', ')', ...base.slice(15)];
    expect(isNearDuplicate(base, withCheck)).toBe(true);
    const withInput = [...base.slice(0, 15), '{', 'event', ':', 'BEGIN', ',', 'bail', ':', 'true', '}', ',', ...base.slice(15)];
    expect(isNearDuplicate(base, withInput)).toBe(false);
    expect(isNearDuplicate(base, [...base.slice(0, 15), ',', ...base.slice(15)])).toBe(true);
  });
});
