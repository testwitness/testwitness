import { describe, expect, it } from 'vitest';
import type { Evidence } from '../types.js';
import { V003, V004, V005, V006 } from './V.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

function evidence(keys: string[], extra: Partial<Evidence> = {}): Evidence {
  const set = new Set(keys);
  return { sources: ['junit.xml'], total: keys.length, passed: keys.length, failed: 0, errored: 0, skipped: 0, flaky: 0, has: (k) => set.has(k), statusOf: (k) => (set.has(k) ? 'passed' : undefined), keysForClass: () => [], ...extra };
}

describe('V003 changed test did not run', () => {
  const P = 'src/billing.test.ts';
  it('reports a modified test absent from results as high when siblings ran', async () => {
    const base = t({ name: 'a', container: ['Billing'], body: 'x' });
    const head = t({ name: 'a', container: ['Billing'], body: 'y' });
    const other = t({ name: 'b', container: ['Billing'], body: 'z' });
    const pair = { file: changedFile(P), base: inventory(P, [base, other]), head: inventory(P, [head, other]) };
    const out = await V003.run(context({ pairs: [pair], evidence: evidence(['billing b::billing b']) }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'high', subject: 'Billing › a' });
  });
  it('reports medium with file not in results when nothing from the file ran', async () => {
    const head = t({ name: 'a', body: 'y' });
    const pair = { file: changedFile(P, 'added'), head: inventory(P, [head]) };
    const out = await V003.run(context({ pairs: [pair], evidence: evidence(['elsewhere::x']) }), {});
    expect(out[0]).toMatchObject({ severity: 'medium', label: 'file not in results' });
  });
  it('downgrades to partial results when most changed files are missing from results', async () => {
    const pairs = ['a', 'b', 'c'].map((n) => ({ file: changedFile(`src/${n}.test.ts`, 'added'), head: inventory(`src/${n}.test.ts`, [t({ name: 'x', body: n })]) }));
    const out = await V003.run(context({ pairs, evidence: evidence(['a::x']) }), {});
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.severity === 'low' && f.label === 'partial results')).toBe(true);
  });
  it('skips skipped tests, matched tests, unchanged tests and runs without evidence', async () => {
    const skipped = t({ name: 's', body: 'x', markers: [{ marker: 'skip', kind: 'skip', constant: true }] });
    const ran = t({ name: 'ran', body: 'x' });
    const same = t({ name: 'same', body: 'q' });
    const pair = { file: changedFile(P), base: inventory(P, [same]), head: inventory(P, [skipped, ran, same]) };
    expect(await V003.run(context({ pairs: [pair], evidence: evidence(['billing::ran']) }), {})).toEqual([]);
    expect(await V003.run(context({ pairs: [pair] }), {})).toEqual([]);
  });
  it('matches java and python keys', async () => {
    const j = { file: changedFile('src/test/java/com/x/CartTest.java', 'added', 'java'), head: inventory('src/test/java/com/x/CartTest.java', [{ ...t({ name: 'adds', body: 'x' }), qualifiedName: 'CartTest#adds' }], { language: 'java' }) };
    const p = { file: changedFile('tests/test_cart.py', 'added', 'python'), head: inventory('tests/test_cart.py', [{ ...t({ name: 'test_adds', body: 'x' }), qualifiedName: 'TestCart::test_adds' }], { language: 'python' }) };
    expect(await V003.run(context({ pairs: [j, p], evidence: evidence(['carttest::adds', 'testcart::test_adds']) }), {})).toEqual([]);
  });
});

describe('V004 claims', () => {
  it('reports unsupported added tests and no test changes claims', async () => {
    const out = await V004.run(context({ pairs: [], prText: { title: 'Fix', body: 'Added tests for this.' } }), {});
    expect(out[0]).toMatchObject({ severity: 'medium', label: 'unsupported', subject: 'added-tests' });
    const pair = { file: changedFile('a.test.ts'), base: inventory('a.test.ts', [t({ name: 'a', body: 'x' })]), head: inventory('a.test.ts', [t({ name: 'a', body: 'y' })]) };
    const out2 = await V004.run(context({ pairs: [pair], prText: { title: 'No test changes', body: '' } }), {});
    expect(out2[0]).toMatchObject({ subject: 'no-test-changes', severity: 'medium' });
  });
  it('reports tests pass as unreadable low without evidence and unsupported with failures', async () => {
    const pr = { title: 'x', body: 'All tests pass.' };
    expect((await V004.run(context({ pairs: [], prText: pr }), {}))[0]).toMatchObject({ severity: 'low', label: 'unreadable' });
    const failing = evidence(['a::b'], { failed: 2 });
    expect((await V004.run(context({ pairs: [], prText: pr, evidence: failing }), {}))[0]).toMatchObject({ severity: 'medium', label: 'unsupported' });
    expect(await V004.run(context({ pairs: [], prText: pr, evidence: evidence(['a::b']) }), {})).toEqual([]);
  });
  it('is silent without PR text or when claims are disabled', async () => {
    expect(await V004.run(context({ pairs: [] }), {})).toEqual([]);
    const ctx = context({ pairs: [], prText: { title: 'tests pass', body: '' } });
    ctx.config.claims.enabled = false;
    expect(await V004.run(ctx, {})).toEqual([]);
  });
});

describe('V005 and V006', () => {
  it('V005 fires only without evidence and when tests or config changed', async () => {
    const pair = { file: changedFile('a.test.ts'), head: inventory('a.test.ts', []) };
    expect(await V005.run(context({ pairs: [pair] }), {})).toHaveLength(1);
    expect(await V005.run(context({ pairs: [pair], evidence: evidence([]) }), {})).toEqual([]);
    expect(await V005.run(context({ pairs: [] }), {})).toEqual([]);
  });
  it('V006 fires when results fail and the PR claims passing', async () => {
    const failing = evidence(['a::b'], { failed: 1 });
    expect((await V006.run(context({ pairs: [], prText: { title: 'CI is green', body: '' }, evidence: failing }), {}))[0]).toMatchObject({ severity: 'high' });
    expect(await V006.run(context({ pairs: [], prText: { title: 'wip', body: '' }, evidence: failing }), {})).toEqual([]);
    expect(await V006.run(context({ pairs: [], prText: { title: 'CI is green', body: '' }, evidence: evidence(['a::b']) }), {})).toEqual([]);
  });
});
