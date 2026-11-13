import { describe, expect, it } from 'vitest';
import { A001, A002, A009 } from './A.js';
import { O001, O002, O006 } from './O.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

const P = 'src/billing.test.ts';
const eq = (subject: string, expected: string, strength = 3, family = 'equality') => ({ callee: 'expect.toBe', subject, expected, text: `expect(${subject}).toBe(${expected})`, family, strength });
const defined = (subject: string) => ({ callee: 'expect.toBeDefined', subject, text: `expect(${subject}).toBeDefined()`, family: 'equality', strength: 1, kind: 'smoke' as const });

describe('A001 assertion removed', () => {
  it('reports lost assertions as low, medium when the subject mentions a changed production stem', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('res.status', '200'), eq('res.body.total', '1250'), eq('ledger.entries.length', '2')] });
    const head = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')] });
    const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
    const out = await A001.run(context({ pairs: [pair] }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'low', message: 'Test a lost 2 of 3 assertions' });
    expect(out[0]!.before).toContain('res.body.total');
    const high = await A001.run(context({ pairs: [pair], changedProduction: ['src/ledger.ts'] }), {});
    expect(high[0]!.severity).toBe('medium');
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

describe('A001 inside an exception expectation', () => {
  const raises = { callee: 'pytest.raises', kind: 'exception' as const, text: 'with pytest.raises(AttributeError):', subject: 'cfg.timeout' };
  const touch = { callee: 'assert', kind: 'smoke' as const, text: 'assert cfg.timeout', subject: 'cfg.timeout', guarded: true };
  const run = (base: ReturnType<typeof t>, head: ReturnType<typeof t>) =>
    A001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }], changedProduction: ['src/cfg.ts'] }), {});

  it('reports low when only guarded assertions go and the expectation stays', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('cfg.region', "'eu'"), raises, touch] });
    const head = t({ name: 'a', body: 'y', assertions: [eq('cfg.region', "'eu'"), raises] });
    expect(await run(base, head)).toMatchObject([{ severity: 'low', label: 'inside exception expectation' }]);
  });

  it('still reports medium when the expectation went too, or an unguarded assertion went', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('cfg.region', "'eu'"), raises, touch] });
    const noExpectation = t({ name: 'a', body: 'y', assertions: [eq('cfg.region', "'eu'")] });
    expect((await run(base, noExpectation))[0]).toMatchObject({ severity: 'medium' });
    const unguarded = t({ name: 'a', body: 'y', assertions: [raises, touch] });
    const out = await run(base, unguarded);
    expect(out[0]).toMatchObject({ severity: 'medium' });
    expect(out[0]!.label).toBeUndefined();
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
    // Production changed raises to medium, and the replaced by call drop brings it back to low.
    expect((await run(head, lostTwo(), ['src/res.ts']))[0]).toMatchObject({ severity: 'low', label: 'replaced by call' });
  });

  it('stays low when the new calls are fewer than the lost assertions, are logs, or were already called in the base', async () => {
    const one = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'res.did_create', line: 3 }] });
    expect((await run(one))[0]).toMatchObject({ severity: 'low' });
    const logs = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'console.log', line: 3 }, { callee: 'print', line: 4 }, { callee: 'logger.info', line: 5 }] });
    expect((await run(logs))[0]).toMatchObject({ severity: 'low' });
    const again = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'pip', line: 3 }, { callee: 'other.pip', line: 4 }] });
    expect((await run(again))[0]).toMatchObject({ severity: 'low' });
    const nested = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'res.did_create', line: 3, statement: false }, { callee: 'res.did_not_create', line: 4, statement: false }] });
    expect((await run(nested))[0]).toMatchObject({ severity: 'low' });
  });

  it('does not count a call on the line of a surviving assertion', async () => {
    const head = t({ name: 'a', body: 'y', assertions: [eq('res.status', '200')], calls: [{ callee: 'expect(res.status).toBe', line: 2 }, { callee: 'res.did_create', line: 5 }] });
    expect((await run(head))[0]).toMatchObject({ severity: 'low' });
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

describe('A002 lattice pairing', () => {
  const run = async (base: ReturnType<typeof t>, head: ReturnType<typeof t>) => A002.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {});
  const val = (callee: string, subject: string, expected?: string, strength = 3) => ({ callee, subject, ...(expected ? { expected } : {}), text: `${callee}(${subject}${expected ? `, ${expected}` : ''})`, family: 'value', strength });

  it('pairs through identity accessors and grades on the lattice', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [val('expect.toHaveLength', 'rows', '3', 2)] });
    const head = t({ name: 'a', body: 'y', assertions: [val('expect.toBeGreaterThan', 'rows.length', '1', 2)] });
    const out = await run(base, head);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'medium' });
    expect(out[0]!.message).toBe('Test a: equality (expect.toHaveLength) on rows became bound (expect.toBeGreaterThan) on rows.length');
  });

  it('is high when the head checks nothing about the value on the same normalised subject', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [val('expect.toBe', 'res.body.trim()', '"ok"')] });
    const head = t({ name: 'a', body: 'y', assertions: [{ ...val('expect.toBeDefined', 'res.body', undefined, 1), kind: 'smoke' as const }] });
    expect((await run(base, head))[0]).toMatchObject({ severity: 'high' });
  });

  it('pairs by position only among related leftovers of equal number, and caps that at medium', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [val('assert.strictEqual', 'line', '"1"'), val('assert.strictEqual', 'column', '"11"')] });
    const head = t({ name: 'a', body: 'y', assertions: [val('assert.ok', 'lineMatch', undefined, 1), val('assert.ok', 'columnMatch', undefined, 1)] });
    const out = await run(base, head);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'medium' });
    expect(out[0]!.message).toContain('1 more assertion was loosened');
    const unrelated = t({ name: 'a', body: 'y', assertions: [val('assert.ok', 'customer', undefined, 1), val('assert.ok', 'columnMatch', undefined, 1)] });
    expect((await run(base, unrelated))[0]!.message).not.toContain('more');
    const fewer = t({ name: 'a', body: 'y', assertions: [val('assert.ok', 'lineMatch', undefined, 1)] });
    expect(await run(base, fewer)).toEqual([]);
  });

  it('is silent on reordered, stronger and same rank assertions', async () => {
    const two = [val('expect.toBe', 'a', '1'), val('expect.toContain', 'b', '"x"', 2)];
    expect(await run(t({ name: 'a', body: 'x', assertions: two }), t({ name: 'a', body: 'y', assertions: [...two].reverse() }))).toEqual([]);
    expect(await run(t({ name: 'a', body: 'x', assertions: [val('expect.toContain', 'b', '"x"', 2)] }), t({ name: 'a', body: 'y', assertions: [val('expect.toBe', 'b', '"x"')] }))).toEqual([]);
    expect(await run(t({ name: 'a', body: 'x', assertions: [val('expect.toBe', 'b.length', '3')] }), t({ name: 'a', body: 'y', assertions: [val('expect.toHaveLength', 'b', '3', 2)] }))).toEqual([]);
  });

  it('reports nested checks at most medium with the nested label, and helpers once with the in helper label', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [] });
    base.embedded = [{ callee: 'hasValueMatching.equalTo', subject: 'event', expected: 'equalTo(4L)', text: 'hasValueMatching(equalTo(4L))', line: 2, kind: 'value', family: 'hamcrest', strength: 4 }];
    const head = t({ name: 'a', body: 'y', assertions: [] });
    head.embedded = [{ callee: 'hasValueMatching.notNullValue', subject: 'event', expected: 'notNullValue()', text: 'hasValueMatching(notNullValue())', line: 2, kind: 'smoke', family: 'hamcrest', strength: 1 }];
    expect(await run(base, head)).toMatchObject([{ severity: 'medium', label: 'nested' }]);
    const helperBase = inventory(P, [], { helperAssertions: { check: [{ ...val('expect.toBe', 'r.total', 'n'), line: 3, kind: 'value' }] } });
    const helperHead = inventory(P, [], { helperAssertions: { check: [{ ...val('expect.toBeDefined', 'r.total', undefined, 1), line: 3, kind: 'smoke' }] } });
    const out = await A002.run(context({ pairs: [{ file: changedFile(P), base: helperBase, head: helperHead }] }), {});
    expect(out).toMatchObject([{ severity: 'medium', subject: 'check', label: 'in helper' }]);
    expect(out[0]!.message).toMatch(/^Helper check: /);
  });
});

describe('A009 tautology', () => {
  it('reports same operand assertions added to a test', async () => {
    const base = t({ name: 'a', body: 'x', assertions: [eq('r', '1')] });
    const head = t({ name: 'a', body: 'y', assertions: [eq('r', '1'), eq('true', 'true'), eq('x', 'x')] });
    const out = await A009.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {});
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.severity === 'low')).toBe(true);
  });
  it('falls back to text patterns and reports low for a new test with only a tautology', async () => {
    const head = t({ name: 'a', body: 'y', assertions: [{ callee: 'assertTrue', text: 'assertTrue(true)' }] });
    const out = await A009.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [head]) }] }), {});
    expect(out[0]).toMatchObject({ severity: 'low' });
    const py = t({ name: 'b', body: 'y', assertions: [{ callee: 'assert', text: 'assert x == x' }, { callee: 'assert', text: 'assert x == y' }] });
    expect(await A009.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [py]) }] }), {})).toHaveLength(1);
  });
  it('does not report pre existing tautologies', async () => {
    const same = t({ name: 'a', body: 'x', assertions: [eq('true', 'true')] });
    expect(await A009.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [same]), head: inventory(P, [same]) }] }), {})).toEqual([]);
  });
});

describe('O001 new test without assertion', () => {
  it('reports low, with the smoke label for smoke named tests, nothing for skipped or empty', async () => {
    const none = t({ name: 'processesBatch', body: 'service.process(batch)' });
    const smoke = t({ name: 'contextLoads', body: 'ctx.start()' });
    const skipped = t({ name: 'later', body: 'x', markers: [{ marker: 'skip', kind: 'skip', constant: true }] });
    const empty = t({ name: 'todo', body: '', statements: 0 });
    const withAssert = t({ name: 'ok', body: 'x', assertions: [eq('a', '1')] });
    const out = await O001.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [none, smoke, skipped, empty, withAssert]) }] }), {});
    expect(out.map((f) => [f.subject, f.severity, f.label])).toEqual([
      ['processesBatch', 'low', undefined],
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

describe('O006 only files a runner collects', () => {
  const added = (path: string) => ({ file: changedFile(path, 'added'), head: inventory(path, []) });
  it('skips support files that no runner collects by name', async () => {
    const paths = [
      'src/test/java/demo/RecordingListener.java',
      'src/test/java/demo/package-info.java',
      'src/test/java/demo/samples/BaseTest.java',
      'src/__tests__/__fixtures__/a.js',
      'src/__tests__/__mocks__/dep.mjs',
      'src/__tests__/graph/dep.mjs',
      'src/__tests__/_utils.ts',
      'tests/harness.ts',
      'test/integration/fixtures/x.fixture.cjs',
      'tests/_cache.py',
      'tests/with_deprecated.py',
    ];
    for (const path of paths) {
      const file = changedFile(path, 'added');
      file.language = path.endsWith('.java') ? 'java' : path.endsWith('.py') ? 'python' : 'typescript';
      expect(await O006.run(context({ pairs: [{ file, head: inventory(path, []) }] }), {}), path).toEqual([]);
    }
  });
  it('still reports runner named files', async () => {
    for (const [path, language] of [
      ['src/test/java/demo/CartTest.java', 'java'],
      ['src/test/java/demo/TestCart.java', 'java'],
      ['tests/test_cart.py', 'python'],
      ['src/__tests__/cart.ts', 'typescript'],
      ['src/cart.spec.ts', 'typescript'],
    ] as const) {
      const file = changedFile(path, 'added');
      file.language = language;
      const out = await O006.run(context({ pairs: [{ file, head: inventory(path, []) }] }), {});
      expect(out.map((f) => f.severity), path).toEqual(['medium']);
    }
  });
  it('reports a runner named script with a top level generator call as low, generated', async () => {
    const pair = added('tests/format/js/format.test.js');
    pair.file.language = 'javascript';
    const ctx = { ...context({ pairs: [pair] }), readHead: async () => 'runFormatTest(import.meta, ["babel"]);\n' };
    expect(await O006.run(ctx, {})).toMatchObject([{ severity: 'low', label: 'generated' }]);
    const suite = { ...context({ pairs: [pair] }), readHead: async () => "describe('x', () => {});\n" };
    expect(await O006.run(suite, {})).toMatchObject([{ severity: 'medium' }]);
  });
});
