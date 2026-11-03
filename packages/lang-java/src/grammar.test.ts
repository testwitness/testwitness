// @ts-nocheck
import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { javaWasmPath, queryPath, readQuerySource } from './grammar.js';

const req = createRequire(import.meta.url);
const bundledWasm = req.resolve('tree-sitter-java/tree-sitter-java.wasm');
const bundledQueries = fileURLToPath(new URL('../queries/', import.meta.url));

describe('asset location', () => {
  let dir: string | undefined;
  afterEach(() => {
    delete process.env['TESTWITNESS_ASSET_DIR'];
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('uses the package relative paths by default', () => {
    expect(javaWasmPath()).toBe(bundledWasm);
    expect(queryPath('tests')).toBe(join(bundledQueries, 'tests.scm'));
  });

  it('reads the wasm and queries from TESTWITNESS_ASSET_DIR when set', () => {
    dir = mkdtempSync(join(tmpdir(), 'tw-assets-'));
    mkdirSync(join(dir, 'queries', 'java'), { recursive: true });
    copyFileSync(bundledWasm, join(dir, 'tree-sitter-java.wasm'));
    for (const name of ['tests', 'assertions', 'markers', 'mocks']) {
      copyFileSync(join(bundledQueries, `${name}.scm`), join(dir, 'queries', 'java', `${name}.scm`));
    }
    process.env['TESTWITNESS_ASSET_DIR'] = dir;
    expect(javaWasmPath()).toBe(join(dir, 'tree-sitter-java.wasm'));
    expect(queryPath('assertions')).toBe(join(dir, 'queries', 'java', 'assertions.scm'));
    expect(readQuerySource('assertions')).toContain('method_invocation');
  });
});
