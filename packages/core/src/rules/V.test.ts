import { describe, expect, it } from 'vitest';
import type { Evidence } from '../types.js';
import { V003, V004, V005, V006, V008, V008_MAX_FILES } from './V.js';
import { readCoverageString, toCoverageEvidence } from '../coverage/reader.js';
import type { ChangedFile, CoverageEvidence } from '../types.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

function evidence(keys: string[], extra: Partial<Evidence> = {}): Evidence {
  const set = new Set(keys);
  return { sources: ['junit.xml'], total: keys.length, passed: keys.length, failed: 0, errored: 0, skipped: 0, flaky: 0, has: (k) => set.has(k), statusOf: (k) => (set.has(k) ? 'passed' : undefined), keysForClass: () => [], keys: () => set.keys(), ...extra };
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
  it('counts table rows, snapshot entries and two or more new assertions as added tests', async () => {
    const pr = { title: 'Fix', body: 'Added tests for this.' };
    const a = (text: string) => ({ callee: 'expect.toBe', text });
    const rows = { file: changedFile('a.test.ts'), base: inventory('a.test.ts', [t({ name: 'a', body: 'x', parameterCount: 3 })]), head: inventory('a.test.ts', [t({ name: 'a', body: 'x', parameterCount: 5 })]) };
    expect(await V004.run(context({ pairs: [rows], prText: pr }), {})).toEqual([]);
    const two = { file: changedFile('a.test.ts'), base: inventory('a.test.ts', [t({ name: 'a', body: 'x', assertions: [a('expect(x).toBe(1)')] })]), head: inventory('a.test.ts', [t({ name: 'a', body: 'y', assertions: [a('expect(x).toBe(1)'), a('expect(y).toBe(2)'), a('expect(z).toBe(3)')] })]) };
    expect(await V004.run(context({ pairs: [two], prText: pr }), {})).toEqual([]);
    const one = { file: changedFile('a.test.ts'), base: inventory('a.test.ts', [t({ name: 'a', body: 'x', assertions: [a('expect(x).toBe(1)')] })]), head: inventory('a.test.ts', [t({ name: 'a', body: 'y', assertions: [a('expect(x).toBe(1)'), a('expect(y).toBe(2)')] })]) };
    expect(await V004.run(context({ pairs: [one], prText: pr }), {})).toHaveLength(1);
    const snap: ChangedFile = { ...changedFile('__snapshots__/f.test.js.snap'), kind: 'snapshot', hunks: [{ baseStart: 9, baseCount: 0, headStart: 10, headCount: 2, removed: [], added: ['exports[`b.js format 1`] = `', '`;'] }] };
    expect(await V004.run(context({ pairs: [], files: [snap], prText: pr }), {})).toEqual([]);
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

describe('V003 template titles', () => {
  it('reads a template literal title as a template', async () => {
    const { templateTitle } = await import('./V.js');
    expect(templateTitle('every fixture parses › `${agent}/${name}`')).toBe('every fixture parses › %s/%s');
    expect(templateTitle('plain `code` title')).toBe('plain `code` title');
    expect(templateTitle('adds %i')).toBe('adds %i');
  });

  it('matches rows of a test whose title is a template literal in a loop', async () => {
    const head = t({ name: '`validates golden case ${c.project}/${c.name}`', container: ['report schema'], body: 'x' });
    const pair = { file: changedFile('src/schema.test.ts', 'modified'), head: inventory('src/schema.test.ts', [head]) };
    const ev = evidence(['report schema validates golden case ts-jest/r003::report schema validates golden case ts-jest/r003']);
    expect(await V003.run(context({ pairs: [pair], evidence: ev }), {})).toEqual([]);
    const other = evidence(['report schema something else::report schema something else']);
    expect(await V003.run(context({ pairs: [pair], evidence: other }), {})).not.toEqual([]);
  });

  it('matches test.each rows written by the producer', async () => {
    const { templateRegex } = await import('./V.js');
    expect(templateRegex('billing charge adds %i and %i to get %i::billing charge adds %i and %i to get %i').test('billing charge adds 1 and 2 to get 3::billing charge adds 1 and 2 to get 3')).toBe(true);
    const head = t({ name: 'adds %i and %i to get %i', container: ['billing'], body: 'x' });
    const pair = { file: changedFile('src/billing.test.ts', 'added'), head: inventory('src/billing.test.ts', [head]) };
    const ev = evidence(['billing adds 1 and 2 to get 3::billing adds 1 and 2 to get 3', 'billing adds 2 and 2 to get 4::billing adds 2 and 2 to get 4']);
    expect(await V003.run(context({ pairs: [pair], evidence: ev }), {})).toEqual([]);
  });
});

describe('V008 changed production lines not executed', () => {
  function prod(path: string, lines: number[], extra: Partial<ChangedFile> = {}): ChangedFile {
    return { status: 'modified', path, kind: 'production', language: 'python', hunks: [], binary: false, addedLines: new Set(lines), removedLines: new Set(), ...extra };
  }
  async function cov(lcov: string): Promise<CoverageEvidence> {
    return toCoverageEvidence(await readCoverageString(lcov, 'lcov.info', '/repo'));
  }
  function ctxWith(files: ChangedFile[], coverage?: CoverageEvidence) {
    const c = context({ pairs: [] });
    c.files = files;
    if (coverage) c.coverage = coverage;
    return c;
  }

  it('reports instrumented changed lines nobody executed, one low finding per file with the first three lines', async () => {
    const c = await cov('SF:/repo/app/refund.py\nDA:1,1\nDA:4,0\nDA:5,0\nDA:7,0\nDA:9,0\nDA:10,2\nend_of_record\n');
    const out = await V008.run(ctxWith([prod('app/refund.py', [3, 4, 5, 6, 7, 9, 10])], c), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'V008', severity: 'low', label: 'uncovered change', subject: 'app/refund.py', location: { path: 'app/refund.py', line: 4 } });
    expect(out[0]!.message).toBe('4 changed lines in app/refund.py never executed by the tests (lines 4, 5, 7 and 1 more)');
    expect(out[0]!.fingerprint).toBe('V008:app/refund.py:app/refund.py');
  });

  it('is silent when changed lines ran, are not instrumented, or the file is not in the report', async () => {
    const c = await cov('SF:/repo/app/a.py\nDA:1,1\nDA:2,0\nend_of_record\n');
    expect(await V008.run(ctxWith([prod('app/a.py', [1, 3])], c), {})).toEqual([]);
    expect(await V008.run(ctxWith([prod('app/b.py', [2])], c), {})).toEqual([]);
  });

  it('ignores test files, deleted files and runs without coverage', async () => {
    const c = await cov('SF:/repo/app/a.py\nDA:2,0\nend_of_record\n');
    expect(await V008.run(ctxWith([prod('app/a.py', [2], { kind: 'test' })], c), {})).toEqual([]);
    expect(await V008.run(ctxWith([prod('app/a.py', [2], { status: 'deleted' })], c), {})).toEqual([]);
    expect(await V008.run(ctxWith([prod('app/a.py', [2])]), {})).toEqual([]);
  });

  it('checks at most the file cap', async () => {
    const lcov = Array.from({ length: V008_MAX_FILES + 5 }, (_, i) => `SF:/repo/f${i}.py\nDA:1,0\nend_of_record`).join('\n');
    const files = Array.from({ length: V008_MAX_FILES + 5 }, (_, i) => prod(`f${i}.py`, [1]));
    expect(await V008.run(ctxWith(files, await cov(lcov)), {})).toHaveLength(V008_MAX_FILES);
  });
});
