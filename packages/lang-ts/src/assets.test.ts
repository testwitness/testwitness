// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { grammarFor, queryPathFor, wasmPathFor } from './grammar.js';
import { buildInventory } from './inventory.js';

/**
 * This file must stay separate from the other suites: the asset directory is read the first
 * time a grammar or query is loaded, so the env var has to be set before anything in this
 * module instance touches grammar.ts.
 */
const require = createRequire(import.meta.url);
const queriesDir = fileURLToPath(new URL('../queries/', import.meta.url));
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-assets-'));
  mkdirSync(join(dir, 'queries', 'ts'), { recursive: true });
  copyFileSync(require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm'), join(dir, 'tree-sitter-typescript.wasm'));
  copyFileSync(require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm'), join(dir, 'tree-sitter-tsx.wasm'));
  copyFileSync(require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'), join(dir, 'tree-sitter-javascript.wasm'));
  copyFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'), join(dir, 'web-tree-sitter.wasm'));
  for (const name of ['tests', 'assertions', 'markers', 'mocks']) {
    copyFileSync(join(queriesDir, `${name}.scm`), join(dir, 'queries', 'ts', `${name}.scm`));
  }
  process.env['TESTWITNESS_ASSET_DIR'] = dir;
});

afterAll(() => {
  delete process.env['TESTWITNESS_ASSET_DIR'];
  rmSync(dir, { recursive: true, force: true });
});

describe('TESTWITNESS_ASSET_DIR', () => {
  it('resolves wasm and query paths under the asset directory', () => {
    expect(wasmPathFor('typescript')).toBe(join(dir, 'tree-sitter-typescript.wasm'));
    expect(wasmPathFor('tsx')).toBe(join(dir, 'tree-sitter-tsx.wasm'));
    expect(wasmPathFor('javascript')).toBe(join(dir, 'tree-sitter-javascript.wasm'));
    expect(queryPathFor('tests')).toBe(join(dir, 'queries', 'ts', 'tests.scm'));
    expect(queryPathFor('assertions')).toBe(join(dir, 'queries', 'ts', 'assertions.scm'));
  });

  it('loads every grammar and its queries from the copies', async () => {
    for (const id of ['typescript', 'tsx', 'javascript'] as const) {
      const { language, queries } = await grammarFor(id);
      expect(language).toBeDefined();
      expect(queries.tests).toBeDefined();
    }
    const inventory = await buildInventory('a.test.ts', `test('x', () => { expect(1).toBe(1); });`, { frameworks: new Set(), extraAssertions: [] });
    expect(inventory.tests.map((t) => t.name)).toEqual(['x']);
    expect(inventory.tests[0]!.assertions.map((a) => a.callee)).toEqual(['expect.toBe']);
  });

  it('falls back to the package paths when the variable is unset', () => {
    const saved = process.env['TESTWITNESS_ASSET_DIR'];
    delete process.env['TESTWITNESS_ASSET_DIR'];
    try {
      expect(wasmPathFor('typescript')).toMatch(/node_modules.*tree-sitter-typescript\.wasm$/);
      expect(queryPathFor('tests')).toBe(join(queriesDir, 'tests.scm'));
    } finally {
      process.env['TESTWITNESS_ASSET_DIR'] = saved;
    }
  });
});
