import { describe, expect, it } from 'vitest';
import { shortHash } from '@testwitness/core';
import { byName, inv, src } from './helpers.test-util.js';
const TIMING_OFF = process.env['TESTWITNESS_TIMING'] === 'off'; // Stryker instruments the code under test, so wall clock budgets do not apply there

describe('edge cases', () => {
  it('returns an empty inventory for an empty file', async () => {
    const inventory = await inv('', 'src/empty.test.ts');
    expect(inventory.tests).toEqual([]);
    expect(inventory.assertionHelpers.size).toBe(0);
    expect(inventory.imports).toEqual([]);
    expect(inventory.fileMarkers).toEqual([]);
    expect(inventory.parseErrors).toBe(0);
    expect(inventory.framework).toBe('jest');
  });

  it('survives a syntax error and reports parseErrors while keeping the intact tests', async () => {
    const inventory = await inv(src(`
      import { test, expect } from 'vitest';
      test('good', () => { expect(1).toBe(1); });
      test('broken', () => {
        expect(1).toBe(
      });
      test('after', () => { expect(2).toBe(2); });
    `), 'src/broken.test.ts');
    expect(inventory.parseErrors).toBeGreaterThan(0);
    expect(inventory.tests.map((t) => t.name)).toContain('good');
    expect(inventory.tests.map((t) => t.name)).toContain('after');
  });

  it('counts an unparseable statement so a test with a syntax error is not read as emptied', async () => {
    const inventory = await inv(src(`
      import { test, expect } from 'vitest';
      test('broken', () => {
        expect(total([1, 2]).toBe(3);
      });
      test('empty', () => {
      });
    `), 'src/broken.test.ts');
    expect(inventory.parseErrors).toBeGreaterThan(0);
    expect(byName(inventory, 'broken').statementCount).toBe(1);
    expect(byName(inventory, 'empty').statementCount).toBe(0);
  });

  it('reports helpers and no tests for a file with only helpers', async () => {
    const inventory = await inv(src(`
      import { expect } from 'vitest';
      export function expectOk(res: Response) {
        expect(res.ok).toBe(true);
      }
      export const expectJson = async (res: Response) => {
        expect(res.headers.get('content-type')).toMatch(/json/);
      };
    `), 'test/helpers.ts');
    expect(inventory.tests).toEqual([]);
    expect([...inventory.assertionHelpers].sort()).toEqual(['expectJson', 'expectOk']);
  });

  it('does not treat assertions in hooks as helpers or tests', async () => {
    const inventory = await inv(src(`
      beforeEach(() => { expect(setup()).toBeTruthy(); });
      afterAll(async () => { expect(await teardown()).toBe(true); });
      describe('d', () => {
        beforeEach(() => { expect(1).toBe(1); });
        it('t', () => {});
      });
    `));
    expect(inventory.assertionHelpers.size).toBe(0);
    expect(inventory.tests.map((t) => t.name)).toEqual(['t']);
    expect(inventory.tests[0]!.assertions).toEqual([]);
  });

  it('ignores dynamic titles that are not strings and calls that only look like tests', async () => {
    const inventory = await inv(src(`
      const title = 'dyn';
      it(title, () => {});
      it.each(cases)(title, () => {});
      test.beforeEach(() => {});
      it.fancy('x', () => {});
      myTest('x', () => {});
      obj.it('x', () => {});
      test('real', () => {});
    `));
    expect(inventory.tests.map((t) => t.name)).toEqual(['real']);
  });

  it('handles a todo test with no body and a test with an empty body', async () => {
    const inventory = await inv(`test.todo('later');\ntest('empty', () => {});\ntest('empty fn', function () {});`);
    const [todo, empty, emptyFn] = inventory.tests;
    expect(todo!.statementCount).toBe(0);
    expect(todo!.bodyHash).toBe(shortHash(''));
    expect(empty!.statementCount).toBe(0);
    expect(empty!.bodyHash).toBe(emptyFn!.bodyHash);
  });

  it('handles duplicate titles in different describes as distinct qualified names', async () => {
    const inventory = await inv(src(`
      describe('a', () => { it('same', () => {}); });
      describe('b', () => { it('same', () => {}); });
    `));
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual(['a › same', 'b › same']);
  });

  it('keeps tests ordered by line', async () => {
    const inventory = await inv(src(`
      describe('z', () => {
        it('third', () => {});
      });
      it('first', () => {});
      describe('a', () => { it('second', () => {}); });
    `));
    expect(inventory.tests.map((t) => t.startLine)).toEqual([2, 4, 5]);
  });

  it('inventories a 500 test file in under one second', async () => {
    const blocks: string[] = ["import { describe, it, expect, vi } from 'vitest';", "vi.mock('../service');"];
    for (let d = 0; d < 25; d++) {
      blocks.push(`describe('group ${d}', () => {`);
      for (let i = 0; i < 20; i++) {
        blocks.push(`  it('case ${i} does the thing', async () => {`);
        blocks.push(`    const r = await run(${i});`);
        blocks.push(`    expect(r.status).toBe(${i % 3});`);
        blocks.push(`    expect(r.items).toHaveLength(${i});`);
        blocks.push(`    expect(spy).toHaveBeenCalledWith(${i});`);
        blocks.push(`    if (r.extra) { expect(r.extra).toMatchSnapshot(); }`);
        blocks.push(`  });`);
      }
      blocks.push(`});`);
    }
    const source = blocks.join('\n');
    // Warm up the grammar and queries once; the budget is for a parsed file, not the wasm load.
    await inv("test('warm', () => {});", 'src/warm.test.ts');
    const started = performance.now();
    const inventory = await inv(source, 'src/big.test.ts');
    const elapsed = performance.now() - started;
    expect(inventory.tests).toHaveLength(500);
    expect(inventory.tests.every((t) => t.assertions.length === 4)).toBe(true);
    expect(inventory.tests.every((t) => t.mocks.length === 1)).toBe(true);
    expect(inventory.tests[499]!.qualifiedName).toBe('group 24 › case 19 does the thing');
    expect(elapsed).toBeLessThan(TIMING_OFF ? Number.POSITIVE_INFINITY : 1000);
  });
});
