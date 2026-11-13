import { describe, expect, it } from 'vitest';
import { shortHash, normaliseText } from '@testwitness/core';
import { byName, inv, single, src } from './helpers.test-util.js';

describe('jest declarations', () => {
  it('builds qualified names from nested describe blocks', async () => {
    const inventory = await inv(src(`
      import { describe, it, expect } from '@jest/globals';
      describe('Billing', () => {
        describe('charge', () => {
          it('rejects expired cards', () => {
            expect(charge(card)).toBe(false);
          });
        });
        test('top level in Billing', () => {
          expect(1).toBe(1);
        });
      });
    `));
    expect(inventory.framework).toBe('jest');
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual([
      'Billing › charge › rejects expired cards',
      'Billing › top level in Billing',
    ]);
    const t = byName(inventory, 'rejects expired cards');
    expect(t.container).toEqual(['Billing', 'charge']);
    expect(t.name).toBe('rejects expired cards');
    expect(t.startLine).toBe(4);
    expect(t.endLine).toBe(6);
    expect(t.framework).toBe('jest');
  });

  it('uses the raw source text for template literal titles', async () => {
    const t = await single(src(`
      const n = 3;
      test(\`handles \${n} items\`, () => { expect(n).toBe(3); });
    `));
    expect(t.name).toBe('`handles ${n} items`');
    expect(t.qualifiedName).toBe('`handles ${n} items`');
  });

  it('hashes the body only, so a rename keeps the hash', async () => {
    const a = await single(`test('a', () => { expect(x).toBe(1); });`);
    const b = await single(`test('renamed', () => {\n  expect(x).toBe(1);\n});`);
    expect(a.bodyHash).toBe(b.bodyHash);
    expect(a.bodyHash).toBe(shortHash(normaliseText('{ expect(x).toBe(1); }')));
    const c = await single(`test('a', () => { expect(x).toBe(2); });`);
    expect(c.bodyHash).not.toBe(a.bodyHash);
  });

  it('counts statements and excludes string literal statements, bare returns and comments', async () => {
    const t = await single(src(`
      test('counts', () => {
        'use strict';
        // TODO: finish
        const a = make();
        a.run();
        if (a.ok) {
          expect(a.value).toBe(1);
        }
        return;
      });
    `));
    expect(t.statementCount).toBe(4);
  });

  it('counts a single expression bodied arrow as one statement', async () => {
    const t = await single(`test('short', () => expect(f()).toBe(1));`);
    expect(t.statementCount).toBe(1);
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toBe']);
  });

  it('counts test.each array tables and reads the each title', async () => {
    const t = await single(src(`
      test.each([
        [1, 1, 2],
        [1, 2, 3],
        [2, 1, 3],
      ])('add(%i, %i) -> %i', (a, b, expected) => {
        expect(add(a, b)).toBe(expected);
      });
    `));
    expect(t.name).toBe('add(%i, %i) -> %i');
    expect(t.parameterCount).toBe(3);
    expect(t.assertions).toHaveLength(1);
  });

  it('counts tagged template each tables by data rows', async () => {
    const t = await single(src(`
      test.each\`
        a    | b    | expected
        \${1} | \${1} | \${2}
        \${1} | \${2} | \${3}
      \`('returns $expected when $a is added to $b', ({ a, b, expected }) => {
        expect(a + b).toBe(expected);
      });
    `));
    expect(t.parameterCount).toBe(2);
  });

  it('leaves parameterCount undefined for a dynamic table', async () => {
    const t = await single(`test.each(cases)('case %s', (c) => { expect(c).toBeDefined(); });`);
    expect(t.parameterCount).toBeUndefined();
  });

  it('multiplies describe.each by test.each', async () => {
    const inventory = await inv(src(`
      describe.each([['a'], ['b']])('group %s', (g) => {
        test.each([1, 2, 3])('n %i', (n) => { expect(n).toBeGreaterThan(0); });
        test('plain', () => { expect(g).toBeDefined(); });
      });
    `));
    expect(byName(inventory, 'n %i').parameterCount).toBe(6);
    expect(byName(inventory, 'plain').parameterCount).toBe(2);
  });

  it('accepts a function reference as the body', async () => {
    const inventory = await inv(src(`
      function checkInvariants(r) { expect(r.ok).toBe(true); }
      test('invariants', checkInvariants);
      test('async body', async function () { await run(); expect(1).toBe(1); });
    `));
    const ref = byName(inventory, 'invariants');
    expect(ref.statementCount).toBe(1);
    expect(ref.bodyHash).toBe(shortHash('checkInvariants'));
    expect(inventory.assertionHelpers.has('checkInvariants')).toBe(true);
    const fn = byName(inventory, 'async body');
    expect(fn.statementCount).toBe(2);
  });
});

describe('jest markers', () => {
  it('reads skip, only, todo and the x and f aliases', async () => {
    const inventory = await inv(src(`
      it.skip('a', () => {});
      test.only('b', () => {});
      test.todo('c');
      xit('d', () => {});
      xtest('e', () => {});
      fit('f', () => {});
      it.concurrent.skip('g', () => {});
    `));
    const kinds = Object.fromEntries(inventory.tests.map((t) => [t.name, t.markers.map((m) => `${m.marker}:${m.kind}:${m.constant}`)]));
    expect(kinds).toEqual({
      a: ['it.skip:skip:true'],
      b: ['test.only:focus:true'],
      c: ['test.todo:todo:true'],
      d: ['xit:skip:true'],
      e: ['xtest:skip:true'],
      f: ['fit:focus:true'],
      g: ['it.concurrent.skip:skip:true'],
    });
    expect(byName(inventory, 'c').statementCount).toBe(0);
  });

  it('applies describe.skip, describe.only, xdescribe and fdescribe to every test inside', async () => {
    const inventory = await inv(src(`
      describe.skip('s', () => {
        it('a', () => { expect(1).toBe(1); });
        describe('inner', () => { it('b', () => {}); });
      });
      xdescribe('x', () => { it('c', () => {}); });
      describe.only('o', () => { it('d', () => {}); });
      fdescribe('f', () => { it('e', () => {}); });
    `));
    expect(byName(inventory, 'a').markers).toEqual([{ marker: 'describe.skip', kind: 'skip', constant: true, line: 1 }]);
    expect(byName(inventory, 'b').markers.map((m) => m.marker)).toEqual(['describe.skip']);
    expect(byName(inventory, 'c').markers.map((m) => m.kind)).toEqual(['skip']);
    expect(byName(inventory, 'd').markers.map((m) => m.kind)).toEqual(['focus']);
    expect(byName(inventory, 'e').markers.map((m) => `${m.marker}:${m.kind}`)).toEqual(['fdescribe:focus']);
  });

  it('records a timeout third argument without treating it as a body', async () => {
    const t = await single(`test('slow', async () => { await go(); expect(1).toBe(1); }, 30000);`);
    expect(t.statementCount).toBe(2);
    expect(t.markers).toEqual([]);
  });
});

describe('jest assertions', () => {
  it('normalises matcher chains including not, resolves and rejects', async () => {
    const t = await single(src(`
      test('chains', async () => {
        expect(a).toBe(1);
        expect(a).not.toBe(2);
        await expect(p).resolves.toEqual({ a: 1 });
        await expect(p).rejects.toThrow(RangeError);
        expect(a).not.toBeNull();
        return expect(q).resolves.toBeDefined();
      });
    `));
    expect(t.assertions.map((a) => [a.callee, a.kind, a.family, a.strength])).toEqual([
      ['expect.toBe', 'value', 'value', 3],
      ['expect.not.toBe', 'value', 'value', 1],
      ['expect.resolves.toEqual', 'value', 'value', 3],
      ['expect.rejects.toThrow', 'exception', 'exception', 2],
      ['expect.not.toBeNull', 'smoke', 'value', 1],
      ['expect.resolves.toBeDefined', 'smoke', 'value', 1],
    ]);
    expect(t.assertions[0]!.subject).toBe('a');
    expect(t.assertions[2]!.text).toBe('await expect(p).resolves.toEqual({ a: 1 });');
    expect(t.assertions[0]!.line).toBe(2);
  });

  it('classifies interaction, exception, snapshot and smoke matchers', async () => {
    const t = await single(src(`
      test('kinds', () => {
        expect(spy).toHaveBeenCalled();
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenCalledWith('a', 1);
        expect(spy).toHaveBeenNthCalledWith(1, 'a');
        expect(() => f()).toThrow();
        expect(() => f()).toThrow('boom');
        expect(() => f()).not.toThrow();
        expect(tree).toMatchSnapshot();
        expect(tree).toMatchInlineSnapshot(\`"x"\`);
        expect(() => f()).toThrowErrorMatchingSnapshot();
        expect(x).toBeDefined();
        expect(x).toBeTruthy();
        expect(x).toBeInstanceOf(Foo);
        expect(x).toBeFalsy();
      });
    `));
    const rows = t.assertions.map((a) => `${a.callee} ${a.kind} ${a.strength}`);
    expect(rows).toEqual([
      'expect.toHaveBeenCalled interaction 1',
      'expect.toHaveBeenCalledTimes interaction 2',
      'expect.toHaveBeenCalledWith interaction 3',
      'expect.toHaveBeenNthCalledWith interaction 3',
      'expect.toThrow exception 1',
      'expect.toThrow exception 2',
      'expect.not.toThrow smoke 0',
      'expect.toMatchSnapshot snapshot 1',
      'expect.toMatchInlineSnapshot snapshot 2',
      'expect.toThrowErrorMatchingSnapshot snapshot 2',
      'expect.toBeDefined smoke 1',
      'expect.toBeTruthy smoke 1',
      'expect.toBeInstanceOf smoke 1',
      'expect.toBeFalsy smoke 1',
    ]);
  });

  it('orders the equality lattice toStrictEqual > toEqual = toBe > toMatchObject > toBeDefined', async () => {
    const t = await single(src(`
      test('lattice', () => {
        expect(o).toStrictEqual({ a: 1 });
        expect(o).toEqual({ a: 1 });
        expect(o).toMatchObject({ a: 1 });
        expect(o).toHaveProperty('a');
        expect(list).toContain(1);
        expect(list).toHaveLength(1);
        expect(s).toMatch(/x/);
        expect(n).toBeGreaterThan(1);
        expect(n).toBeCloseTo(1.5, 1);
      });
    `));
    const strengths = t.assertions.map((a) => a.strength);
    expect(strengths).toEqual([4, 3, 2, 2, 2, 2, 2, 2, 2]);
    expect(t.assertions.map((a) => a.family)).toEqual([
      'value', 'value', 'value', 'value', 'value', 'value', 'value', 'value', 'value',
    ]);
  });

  it('keeps every value matcher in one family so A002 can pair toEqual with toMatchObject and toBe with toBeDefined', async () => {
    const t = await single(src(`
      test('families', () => {
        expect(receipt).toEqual({ total: 11 });
        expect(receipt).toMatchObject({ total: 11 });
        expect(receipt.total).toBe(11);
        expect(receipt.total).toBeGreaterThan(0);
        expect(receipt.total).toBeDefined();
        expect(spy).toHaveBeenCalledWith(11);
        expect(() => f()).toThrow();
      });
    `));
    expect(t.assertions.map((a) => `${a.family}:${a.strength}`)).toEqual([
      'value:3', 'value:2', 'value:3', 'value:2', 'value:1', 'interaction:3', 'exception:1',
    ]);
  });

  it('records expect.assertions and expect.hasAssertions as count declarations', async () => {
    const t = await single(src(`
      test('count', async () => {
        expect.assertions(1);
        expect.hasAssertions();
        await thing();
      });
    `));
    expect(t.assertions.map((a) => [a.callee, a.family, a.subject])).toEqual([
      ['expect.assertions', 'count', undefined],
      ['expect.hasAssertions', 'count', undefined],
    ]);
  });

  it('finds assertions inside loops, callbacks and try blocks within the test', async () => {
    const t = await single(src(`
      test('nested', async () => {
        for (const x of xs) {
          expect(x).toBeGreaterThan(0);
        }
        xs.forEach((x) => expect(x).toBeLessThan(10));
        try {
          await f();
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      });
    `));
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toBeGreaterThan', 'expect.toBeLessThan', 'expect.toBeInstanceOf']);
    expect(t.statementCount).toBe(6);
  });

  it('does not count the callback body of expect(() => f()).toThrow() as a separate assertion', async () => {
    const t = await single(src(`
      function assertOk(r) { expect(r).toBe(true); }
      test('cb', () => {
        expect(() => assertOk(r)).toThrow();
      });
    `));
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toThrow']);
  });
});

describe('jest custom assertion helpers', () => {
  it('detects helpers defined in the file and classifies calls to them as custom', async () => {
    const inventory = await inv(src(`
      import { expect, test } from '@jest/globals';
      function expectValidUser(u) {
        expect(u.id).toBeDefined();
        expect(u.email).toMatch(/@/);
      }
      const expectEmpty = (list) => expect(list).toHaveLength(0);
      export const checks = {
        expectSorted(list) { expect([...list].sort()).toEqual(list); },
      };
      function testHelperNamedLikeATest() { expect(1).toBe(1); }
      function noAssertions(x) { return x + 1; }
      test('uses helpers', async () => {
        const u = await load();
        expectValidUser(u);
        await expectEmpty(u.items);
        noAssertions(u);
      });
    `));
    expect([...inventory.assertionHelpers].sort()).toEqual(['expectEmpty', 'expectSorted', 'expectValidUser']);
    const t = byName(inventory, 'uses helpers');
    expect(t.assertions.map((a) => [a.callee, a.kind, a.subject])).toEqual([
      ['expectValidUser', 'custom', 'u'],
      ['expectEmpty', 'custom', 'u.items'],
    ]);
  });

  it('classifies calls by name convention, bare or on any receiver, as custom assertions', async () => {
    const inventory = await inv(src(`
      import { expect, test } from '@jest/globals';
      import { assertReceipt, checkTotals } from './helpers';
      test('named helpers', async () => {
        const r = await charge(5);
        assertReceipt(r);
        checkTotals(cart);
        screen.verifyToast();
        await page.expectVisible(x);
        this.validateState(store, 2);
        shouldMatch(a, b);
        (await build()).verifyHeaders();
        render(r);
        checkedIn.push(r);
        await page.check('#box');
        const ok = checkSomething(r);
        expect(ok).toBe(true);
      });
    `));
    const t = byName(inventory, 'named helpers');
    expect(t.assertions.map((a) => [a.callee, a.kind, a.subject])).toEqual([
      ['assertReceipt', 'custom', 'r'],
      ['checkTotals', 'custom', 'cart'],
      ['verifyToast', 'custom', undefined],
      ['expectVisible', 'custom', 'x'],
      ['validateState', 'custom', 'store'],
      ['shouldMatch', 'custom', 'a'],
      ['verifyHeaders', 'custom', undefined],
      ['expect.toBe', 'value', 'ok'],
    ]);
  });

  it('keeps expect.assertions and expect.hasAssertions as count smoke assertions', async () => {
    const t = await single(src(`
      test('x', async () => {
        expect.assertions(2);
        expect.hasAssertions();
        await run();
      });
    `));
    expect(t.assertions.map((a) => [a.callee, a.kind, a.family])).toEqual([
      ['expect.assertions', 'smoke', 'count'],
      ['expect.hasAssertions', 'smoke', 'count'],
    ]);
  });

  it('honours profile.extraAssertions', async () => {
    const t = await single(`test('x', () => { assertSchema(doc); });`, 'a.test.ts', {
      frameworks: new Set(['jest']),
      extraAssertions: ['assertSchema'],
    });
    expect(t.assertions).toEqual([
      { callee: 'assertSchema', kind: 'custom', subject: 'doc', text: 'assertSchema(doc);', line: 1 },
    ]);
  });
});

describe('jest mocks', () => {
  it('collects hoisted jest.mock, describe level spyOn and body level mocks', async () => {
    const inventory = await inv(src(`
      jest.mock('../billing');
      jest.doMock('./config', () => ({}));
      describe('svc', () => {
        beforeEach(() => { jest.spyOn(api, 'fetch'); });
        test('a', () => {
          jest.spyOn(console, 'log').mockImplementation(() => {});
          const fn = jest.fn();
          expect(fn).not.toHaveBeenCalled();
        });
      });
      test('b', () => { expect(1).toBe(1); });
    `));
    expect(byName(inventory, 'a').mocks).toEqual(['../billing', './config', 'api.fetch', 'console.log']);
    expect(byName(inventory, 'b').mocks).toEqual(['../billing', './config']);
    expect(inventory.imports).toEqual([]);
  });

  it('collects imports from import statements and require calls', async () => {
    const inventory = await inv(src(`
      import { describe, it } from '@jest/globals';
      import * as billing from '../billing';
      const sinon = require('sinon');
      it('x', () => {});
    `));
    expect(inventory.imports).toEqual(['@jest/globals', '../billing', 'sinon']);
  });
});

describe('jest parameterised flag', () => {
  it('sets parameterised on each tables, countable or not, and on describe.each children', async () => {
    const inventory = await inv(src(`
      const rows = load();
      test.each([[1], [2]])('literal %i', (n) => { expect(n).toBe(n); });
      test.each(rows)('variable %i', (n) => { expect(n).toBe(n); });
      it.each(cases())('call %i', (n) => { expect(n).toBe(n); });
      test.each\`
        a | b
        \${1} | \${2}
      \`('template $a', ({ a, b }) => { expect(a).toBeLessThan(b); });
      describe.each(rows)('group %s', (r) => {
        it('inside', () => { expect(r).toBeDefined(); });
      });
      it('plain', () => { expect(1).toBe(1); });
    `));
    expect(byName(inventory, 'literal %i')).toMatchObject({ parameterCount: 2, parameterised: true });
    expect(byName(inventory, 'variable %i').parameterCount).toBeUndefined();
    expect(byName(inventory, 'variable %i').parameterised).toBe(true);
    expect(byName(inventory, 'call %i').parameterised).toBe(true);
    expect(byName(inventory, 'template $a')).toMatchObject({ parameterCount: 1, parameterised: true });
    expect(byName(inventory, 'inside').parameterised).toBe(true);
    expect(byName(inventory, 'inside').parameterCount).toBeUndefined();
    expect(byName(inventory, 'plain').parameterised).toBeUndefined();
  });
});

describe('jest catch alls', () => {
  it('records every catch clause in the test body with its binding and whether it swallows', async () => {
    const inventory = await inv(src(`
      test('swallows', async () => {
        try {
          await svc.reconcile(ledger);
          expect(ledger.drift()).toBe(0);
        } catch (e) {
          // ignore transient failures
        }
        try { risky(); } catch { log('x'); }
      });
      test('handles', async () => {
        try {
          await svc.reconcile(ledger);
        } catch (err) {
          expect(err.message).toMatch(/drift/);
        }
        try { a(); } catch (e) { throw e; }
        try { b(); } catch (e) { fail('unexpected'); }
        try { c(); } catch (e: unknown) { assert.fail(String(e)); }
        try { d(); } finally { cleanup(); }
      });
      test('nested functions are not the test body', () => {
        const helper = () => { try { x(); } catch (e) {} };
        (async () => { try { y(); } catch (e) {} })();
        helper();
        expect(1).toBe(1);
      });
    `));
    expect(byName(inventory, 'swallows').catchAlls).toEqual([
      { line: 5, binding: 'e', swallows: true, snippet: 'await svc.reconcile(ledger);' },
      { line: 8, binding: 'any', swallows: true, snippet: 'risky();' },
    ]);
    const handles = byName(inventory, 'handles').catchAlls!;
    expect(handles.map((c) => [c.binding, c.swallows])).toEqual([
      ['err', false],
      ['e', false],
      ['e', false],
      ['e', false],
    ]);
    expect(byName(inventory, 'nested functions are not the test body').catchAlls).toEqual([
      { line: 23, binding: 'e', swallows: true, snippet: 'y();' },
    ]);
  });

  it('does not count capture then assert as swallowing, and marks a voided background promise', async () => {
    const inventory = await inv(src(`
      test('captures', async () => {
        let error: any = null;
        try { validate('a.json', 'css'); } catch (error_) { error = error_; }
        expect(error).toBeInstanceOf(TypeError);
        const rejected = await evaluate(deep).catch((e) => e);
        expect(rejected.message).toMatch(/deep/);
      });
      test('captures and forgets', async () => {
        let error: any = null;
        try { validate('a.json', 'css'); } catch (error_) { error = error_; }
        const rejected = await evaluate(deep).catch((e) => e);
        console.log(error, rejected);
      });
      test('background', async () => {
        void client.openTab('Beta').catch(() => {});
        await expect.poll(() => server.pending()).toBe(1);
      });
    `));
    expect(byName(inventory, 'captures').catchAlls!.map((c) => c.swallows)).toEqual([false, false]);
    expect(byName(inventory, 'captures and forgets').catchAlls!.map((c) => c.swallows)).toEqual([true, true]);
    expect(byName(inventory, 'background').catchAlls).toMatchObject([{ swallows: true, background: true }]);
  });

  it('reads tests declared through a local binding of test, conditional when it picks test.skip', async () => {
    const inventory = await inv(src(`
      const testWithVmEsm = typeof globalThis.vm === 'object' ? test : test.skip;
      const run = test;
      const notATest = makeRunner();
      describe('graph', () => {
        testWithVmEsm('loads a module', () => { expect(load('a')).toBe(1); });
        run('runs always', () => { expect(1).toBe(1); });
        notATest('ignored', () => { expect(1).toBe(1); });
      });
    `));
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual(['graph › loads a module', 'graph › runs always']);
    expect(byName(inventory, 'loads a module').markers.map((m) => m.kind)).toEqual(['conditional-skip']);
    expect(byName(inventory, 'runs always').markers).toEqual([]);
  });

  it('reads tests declared through an imported wrapper named like a test function', async () => {
    const inventory = await inv(src(`
      import { testWithVmEsm, testUtils } from '@acme/test-utils';
      testWithVmEsm('loads a module', () => { expect(load('a')).toBe(1); });
      testUtils.setup('not a test', () => {});
    `));
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual(['loads a module']);
  });

  it('records promise .catch handlers that swallow', async () => {
    const inventory = await inv(src(`
      test('promise catches', async () => {
        await svc.sync(ledger).catch(() => {});
        await svc.sync(ledger).catch(noop);
        await svc.sync(ledger).catch((e) => { expect(e).toBeUndefined(); });
        await svc.sync(ledger).catch((e) => { throw e; });
        svc.sync(ledger).then(check).catch(done);
        expect(1).toBe(1);
      });
    `));
    const all = byName(inventory, 'promise catches').catchAlls!;
    expect(all.map((c) => [c.line, c.binding, c.swallows, c.snippet])).toEqual([
      [2, 'promise catch', true, 'svc.sync(ledger)'],
      [3, 'promise catch', true, 'svc.sync(ledger)'],
      [4, 'promise catch', false, 'svc.sync(ledger)'],
      [5, 'promise catch', false, 'svc.sync(ledger)'],
      [6, 'promise catch', false, 'svc.sync(ledger).then(check)'],
    ]);
  });
});

describe('calls (A001 replaced by call)', () => {
  it('lists every call and marks whole expression statements, awaited ones included', async () => {
    const t = await single(src(`
      it('installs', async () => {
        const result = runInstall('leftpad');
        result.didCreate(join('node_modules', 'leftpad'));
        await client.flush();
        expect(result.code).toBe(0);
      });
    `));
    const calls = (t.calls ?? []).map((c) => `${c.name}:${c.statement ? 'stmt' : 'nested'}`);
    expect(calls).toEqual(['runInstall:nested', 'didCreate:stmt', 'join:nested', 'flush:stmt', 'toBe:stmt', 'expect:nested']);
    expect(t.calls?.find((c) => c.name === 'didCreate')).toMatchObject({ callee: 'result.didCreate', line: 3 });
  });

  it('treats an expression bodied arrow as one call statement', async () => {
    const t = await single(src(`
      it('flushes', () => client.flush());
    `));
    expect(t.calls).toEqual([{ callee: 'client.flush', name: 'flush', line: 1, statement: true, text: 'client.flush()' }]);
  });
});
