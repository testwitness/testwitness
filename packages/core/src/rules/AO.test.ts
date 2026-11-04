import { describe, expect, it } from 'vitest';
import { A001, A002, A009 } from './A.js';
import { O001, O002, O006 } from './O.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

const P = 'src/billing.test.ts';
const eq = (subject: string, expected: string, strength = 3, family = 'equality') => ({ callee: 'expect.toBe', subject, expected, text: `expect(${subject}).toBe(${expected})`, family, strength });
const defined = (subject: string) => ({ callee: 'expect.toBeDefined', subject, text: `expect(${subject}).toBeDefined()`, family: 'equality', strength: 1, kind: 'smoke' as const });

describe('A001 assertion removed', () => {
  it('reports lost assertions as medium, high when the subject mentions a changed production stem', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('res.status', '200'), eq('res.body.total', '1250'), eq('ledger.entries.length', '2')] });
    const head = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
    const out = await A001.run(context({ pairs: [pair] }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'medium', message: 'Test a lost 2 of 3 assertions' });
    expect(out[0]!.before).toContain('res.body.total');
    const high = await A001.run(context({ pairs: [pair], changedProduction: ['src/ledger.ts'] }), {});
    expect(high[0]!.severity).toBe('high');
  });

  it('reports consolidation onto the parent expression as low', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('res.a', '1'), eq('res.b', '2'), eq('res.c', '3')] });
    const head = t({ name: 'a', body: 'y', assertions: [{ callee: 'expect.toEqual', subject: 'res', expected: '{a:1,b:2,c:3}', text: 'expect(res).toEqual({a:1,b:2,c:3})' }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
    expect((await A001.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'low', label: 'consolidated' });
  });

  it('reports assertions moved to a sibling test in the same group as low', async () => {
    const base1 = t({ name: 'a', container: ['Billing'], body: 'x', assertions: [eq('x', '1'), eq('y', '2')] });
    const head1 = t({ name: 'a', container: ['Billing'], body: 'x2', assertions: [eq('x', '1')] });
    const base2 = t({ name: 'b', container: ['Billing'], body: 'z', assertions: [] });
    const head2 = t({ name: 'b', container: ['Billing'], body: 'z2', assertions: [eq('y', '2')] });
    const pair = { file: changedFile(P), base: inventory(P, [base1, base2]), head: inventory(P, [head1, head2]) };
    expect((await A001.run(context({ pairs: [pair] }), {}))[0]).toMatchObject({ severity: 'low', label: 'assertions moved' });
  });

  it('does not report when the count did not drop or the body was emptied', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('x', '1')] });
    const same = t({ name: 'a', body: 'y', assertions: [eq('x', '2')] });
    expect(await A001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [same]) }] }), {})).toEqual([]);
    const emptied = t({ name: 'a', body: '', statements: 0, assertions: [] });
    expect(await A001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [emptied]) }] }), {})).toEqual([]);
  });
});

describe('A001 replaced by call', () => {
  const lostTwo = () => t({ name: 'a', body: 'x', assertions: [eq('res.status', '200'), eq('res.created', 'a'), eq('res.deleted', 'b')], calls: [{ callee: 'pip', line: 2, statement: false }] });
  const run = async (head: ReturnType<typeof t>, base = lostTwo(), changedProduction: string[] = []) =>
    A001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }], changedProduction }), {});

  it('reports low when new call statements match the lost assertions one for one, naming the first callee', async () => {
    const head = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'pip', line: 2, statement: false }, { callee: 'res.did_create', line: 3 }, { callee: 'res.did_not_create', line: 4 }] });
    const out = await run(head);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'low', label: 'replaced by call' });
    expect(out[0]!.message).toContain('first did_create');
    // Production changed: high drops one step to medium, never to low.
    expect((await run(head, lostTwo(), ['src/res.ts']))[0]).toMatchObject({ severity: 'medium', label: 'replaced by call' });
  });

  it('stays medium when the new calls are fewer than the lost assertions, are logs, or were already called in the base', async () => {
    const one = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'res.did_create', line: 3 }] });
    expect((await run(one))[0]).toMatchObject({ severity: 'medium' });
    const logs = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'console.log', line: 3 }, { callee: 'print', line: 4 }, { callee: 'logger.info', line: 5 }] });
    expect((await run(logs))[0]).toMatchObject({ severity: 'medium' });
    const again = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'pip', line: 3 }, { callee: 'other.pip', line: 4 }] });
    expect((await run(again))[0]).toMatchObject({ severity: 'medium' });
    const nested = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'res.did_create', line: 3, statement: false }, { callee: 'res.did_not_create', line: 4, statement: false }] });
    expect((await run(nested))[0]).toMatchObject({ severity: 'medium' });
  });

  it('does not count a call on the line of a surviving assertion', async () => {
    const head = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'expect(res.status).toBe', line: 2 }, { callee: 'res.did_create', line: 5 }] });
    expect((await run(head))[0]).toMatchObject({ severity: 'medium' });
  });
});

describe('A002 assertion loosened', () => {
  it('reports a two step drop as high and a one step drop as medium', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('invoice.total()', '12.50', 3)] });
    const head = t({ name: 'a', body: 'y', assertions: [{ ...defined('invoice.total()') }] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
    const out = await A002.run(context({ pairs: [pair] }), {});
    expect(out[0]).toMatchObject({ severity: 'high', before: 'expect(invoice.total()).toBe(12.50)', after: 'expect(invoice.total()).toBeDefined()' });
    const one = t({ name: 'a', body: 'y', assertions: [{ callee: 'expect.toMatchObject', subject: 'invoice.total()', text: 'expect(invoice.total()).toMatchObject({})', family: 'equality', strength: 2 }] });
    expect((await A002.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [one]) }] }), {}))[0]!.severity).toBe('medium');
  });

  it('reports low when a stronger assertion on a sub expression accompanies the move', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('res', '{id:7,ok:true}', 3)] });
    const head = t({ name: 'a', body: 'y', assertions: [{ callee: 'expect.toMatchObject', subject: 'res', text: 'expect(res).toMatchObject({ok:true})', family: 'equality', strength: 2 }, eq('res.id', '7', 3)] });
    const out = await A002.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {});
    expect(out[0]).toMatchObject({ severity: 'low', label: 'narrowed' });
  });

  it('ignores strengthening, unrelated subjects and unknown families', async () => {
    const weak = t({ name: 'a', body: 'x', assertions: [defined('r')] });
    const strong = t({ name: 'a', body: 'y', assertions: [eq('r', '1')] });
    expect(await A002.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [weak]), head: inventory(P, [strong]) }] }), {})).toEqual([]);
    const nofam = t({ name: 'a', body: 'y', assertions: [{ callee: 'custom', subject: 'r', text: 'custom(r)' }] });
    expect(await A002.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [strong]), head: inventory(P, [nofam]) }] }), {})).toEqual([]);
  });
});

describe('A009 tautology', () => {
  it('reports same operand assertions added to a test', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('r', '1')] });
    const head = t({ name: 'a', body: 'y', assertions: [eq('r', '1'), eq('true', 'true'), eq('x', 'x')] });
    const out = await A009.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {});
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.severity === 'high')).toBe(true);
  });
  it('falls back to text patterns and reports medium for a new test with only a tautology', async () => {
    const head = t({ name: 'a', body: 'y', assertions: [{ callee: 'assertTrue', text: 'assertTrue(true)' }] });
    const out = await A009.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [head]) }] }), {});
    expect(out[0]).toMatchObject({ severity: 'medium' });
    const py = t({ name: 'b', body: 'y', assertions: [{ callee: 'assert', text: 'assert x == x' }, { callee: 'assert', text: 'assert x == y' }] });
    expect(await A009.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [py]) }] }), {})).toHaveLength(1);
  });
  it('does not report pre existing tautologies', async () => {
    const same = t({ name: 'a', body: 'x', assertions: [eq('true', 'true')] });
    expect(await A009.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [same]), head: inventory(P, [same]) }] }), {})).toEqual([]);
  });
});

describe('O001 new test without assertion', () => {
  it('reports high, low with smoke label for smoke named tests, nothing for skipped or empty', async () => {
    const none = t({ name: 'processesBatch', body: 'service.process(batch)' });
    const smoke = t({ name: 'contextLoads', body: 'ctx.start()' });
    const skipped = t({ name: 'later', body: 'x', markers: [{ marker: 'skip', kind: 'skip', constant: true }] });
    const empty = t({ name: 'todo', body: '', statements: 0 });
    const withAssert = t({ name: 'ok', body: 'x', assertions: [eq('a', '1')] });
    const out = await O001.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [none, smoke, skipped, empty, withAssert]) }] }), {});
    expect(out.map((f) => [f.subject, f.severity, f.label])).toEqual([
      ['processesBatch', 'high', undefined],
      ['contextLoads', 'low', 'smoke'],
    ]);
  });
  it('ignores pre existing assertion free tests', async () => {
    const none = t({ name: 'a', body: 'x' });
    expect(await O001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [none]), head: inventory(P, [none]) }] }), {})).toEqual([]);
  });
});

describe('O002 smoke oracle', () => {
  it('reports new tests whose only assertions are smoke or snapshot', async () => {
    const smoke = t({ name: 'a', body: 'x', assertions: [defined('computeDiscount(cart)')] });
    const snap = t({ name: 'b', body: 'y', assertions: [{ callee: 'expect.toMatchSnapshot', kind: 'snapshot', text: 'expect(r).toMatchSnapshot()' }] });
    const mixed = t({ name: 'c', body: 'z', assertions: [defined('r'), eq('r.id', '1')] });
    const out = await O002.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [smoke, snap, mixed]) }] }), {});
    expect(out.map((f) => f.subject)).toEqual(['a', 'b']);
    expect(out[0]!.severity).toBe('low');
    const reg = await O002.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [smoke]) }], prText: { title: 'Add regression test for #9', body: '' } }), {});
    expect(reg[0]!.severity).toBe('medium');
  });
});

describe('O006 new test file with no tests', () => {
  it('reports an added test file whose inventory is empty and parses cleanly', async () => {
    const out = await O006.run(context({ pairs: [{ file: changedFile('tests/helpers.test.ts', 'added'), head: inventory('tests/helpers.test.ts', []) }] }), {});
    expect(out[0]).toMatchObject({ severity: 'medium', ruleId: 'O006' });
    const broken = inventory('tests/x.test.ts', [], { parseErrors: 3 });
    expect(await O006.run(context({ pairs: [{ file: changedFile('tests/x.test.ts', 'added'), head: broken }] }), {})).toEqual([]);
  });
});
