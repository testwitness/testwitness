import { describe, expect, it } from 'vitest';
import { R001, R002, R003, R004, R005, R006, R010 } from './R.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

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
