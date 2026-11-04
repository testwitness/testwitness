import { describe, expect, it } from 'vitest';
import { byName, inv, single, src } from './helpers.test-util.js';

describe('vitest declarations and markers', () => {
  it('detects vitest from the import and reads skipIf, runIf, fails, todo and concurrent', async () => {
    const inventory = await inv(src(`
      import { describe, it, test, expect, vi } from 'vitest';
      describe('suite', () => {
        it.skipIf(process.env.CI)('not on ci', () => { expect(1).toBe(1); });
        it.skipIf(true)('always skipped', () => {});
        it.runIf(false)('never runs', () => {});
        it.runIf(isLinux)('linux only', () => {});
        it.skipIf(false)('folds to running', () => {});
        it.runIf(true)('also folds to running', () => {});
        test.fails('expected failure', () => { expect(1).toBe(2); });
        test.todo('later');
        test.concurrent('parallel', async () => { expect(await f()).toBe(1); });
        test.concurrent.skip.each([[1], [2]])('cs %i', (n) => { expect(n).toBe(n); });
      });
    `));
    expect(inventory.framework).toBe('vitest');
    const m = (name: string) => byName(inventory, name).markers.map((x) => `${x.marker}:${x.kind}:${x.constant}`);
    expect(m('not on ci')).toEqual(['it.skipIf:conditional-skip:false']);
    expect(m('always skipped')).toEqual(['it.skipIf:conditional-skip:true']);
    expect(m('never runs')).toEqual(['it.runIf:conditional-skip:true']);
    expect(m('linux only')).toEqual(['it.runIf:conditional-skip:false']);
    expect(m('folds to running')).toEqual([]);
    expect(m('also folds to running')).toEqual([]);
    expect(m('expected failure')).toEqual(['test.fails:xfail:true']);
    expect(m('later')).toEqual(['test.todo:todo:true']);
    expect(m('parallel')).toEqual([]);
    expect(m('cs %i')).toEqual(['test.concurrent.skip:skip:true']);
    expect(byName(inventory, 'cs %i').parameterCount).toBe(2);
  });

  it('reads the object options form test(name, { skip, only, todo, fails, timeout }, fn)', async () => {
    const inventory = await inv(src(`
      import { test, expect } from 'vitest';
      test('a', { skip: true }, () => { expect(1).toBe(1); });
      test('b', { only: true, timeout: 5000 }, () => {});
      test('c', { todo: true });
      test('d', { fails: true, retry: 2 }, () => {});
      test('e', { skip: isWindows }, () => {});
      test('f', { skip: 'flaky on CI' }, () => {});
      test('g', { timeout: 1000 }, () => { expect(1).toBe(1); });
    `));
    const m = (name: string) => byName(inventory, name).markers.map((x) => `${x.kind}:${x.constant}:${x.reason ?? ''}`);
    expect(m('a')).toEqual(['skip:true:']);
    expect(m('b')).toEqual(['focus:true:']);
    expect(m('c')).toEqual(['todo:true:']);
    expect(m('d')).toEqual(['xfail:true:']);
    expect(m('e')).toEqual(['conditional-skip:false:']);
    expect(m('f')).toEqual(['skip:true:flaky on CI']);
    expect(m('g')).toEqual([]);
    expect(byName(inventory, 'a').statementCount).toBe(1);
    expect(byName(inventory, 'a').assertions).toHaveLength(1);
  });

  it('treats suite and describe.each the same way and reads test.for tables', async () => {
    const inventory = await inv(src(`
      import { suite, test, expect } from 'vitest';
      suite('math', () => {
        test.for([[1, 2], [2, 3]])('next of %i is %i', ([a, b]) => { expect(a + 1).toBe(b); });
        test.each([{ a: 1 }, { a: 2 }, { a: 3 }])('obj $a', ({ a }) => { expect(a).toBeGreaterThan(0); });
      });
    `));
    expect(byName(inventory, 'next of %i is %i').qualifiedName).toBe('math › next of %i is %i');
    expect(byName(inventory, 'next of %i is %i').parameterCount).toBe(2);
    expect(byName(inventory, 'obj $a').parameterCount).toBe(3);
  });

  it('detects vitest from vi usage without an import', async () => {
    const inventory = await inv(`vi.mock('../db');\ntest('x', () => { expect(db).toBeDefined(); });`);
    expect(inventory.framework).toBe('vitest');
    expect(inventory.tests[0]!.mocks).toEqual(['../db']);
  });
});

describe('vitest assertions and mocks', () => {
  it('handles expect.soft, expect.poll, vi.spyOn and vi.mock with a factory', async () => {
    const t = await single(src(`
      import { test, expect, vi } from 'vitest';
      vi.mock('../billing', () => ({ charge: vi.fn() }));
      test('soft', async () => {
        const spy = vi.spyOn(service, 'charge');
        expect.soft(result.total).toBe(10);
        expect.soft(result.items).toHaveLength(2);
        await expect.poll(() => counter.value).toBe(3);
        expect(spy).toHaveBeenCalledOnce();
        await expect(service.run()).rejects.toThrowError(/bad/);
      });
    `));
    expect(t.mocks).toEqual(['../billing', 'service.charge']);
    expect(t.assertions.map((a) => [a.callee, a.subject, a.expected, a.kind, a.strength])).toEqual([
      ['expect.soft.toBe', 'result.total', '10', 'value', 3],
      ['expect.soft.toHaveLength', 'result.items', '2', 'value', 2],
      ['expect.poll.toBe', '() => counter.value', '3', 'value', 3],
      ['expect.toHaveBeenCalledOnce', 'spy', undefined, 'interaction', 2],
      ['expect.rejects.toThrowError', 'service.run()', '/bad/', 'exception', 2],
    ]);
  });

  it('reads the vitest assert api', async () => {
    const t = await single(src(`
      import { test, assert } from 'vitest';
      test('assert api', () => {
        assert.equal(a, 1);
        assert.deepEqual(o, { a: 1 });
        assert.isTrue(flag);
        assert.exists(thing);
        assert(ok, 'must be ok');
      });
    `));
    expect(t.assertions.map((a) => [a.callee, a.kind, a.family, a.strength, a.subject, a.expected])).toEqual([
      ['assert.equal', 'value', 'value', 3, 'a', '1'],
      ['assert.deepEqual', 'value', 'value', 3, 'o', '{ a: 1 }'],
      ['assert.isTrue', 'value', 'value', 3, 'flag', undefined],
      ['assert.exists', 'smoke', 'value', 1, 'thing', undefined],
      ['assert', 'smoke', 'value', 1, 'ok', undefined],
    ]);
  });
});

describe('assertions in nested scopes', () => {
  it('counts expect calls inside an arrow function callback', async () => {
    const t = await single(src(`
      import { it, expect } from 'vitest';
      it('listens', () => {
        bus.on('x', (e) => { expect(e.name).toBe('x'); });
        bus.emit('x');
      });
    `));
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toBe']);
  });

  it('counts expect calls inside a function expression', async () => {
    const t = await single(src(`
      import { it, expect } from 'vitest';
      it('listens', () => {
        bus.on('x', function (e) { expect(e.name).toBe('x'); });
        bus.emit('x');
      });
    `));
    expect(t.assertions).toHaveLength(1);
  });

  it('counts expect calls inside a callback passed to a call', async () => {
    const t = await single(src(`
      import { it, expect } from 'vitest';
      it('reads', async () => {
        await withFile('a.txt', async (file) => {
          expect(await file.read()).toBe('a');
        });
      });
    `));
    expect(t.assertions).toHaveLength(1);
  });
});
