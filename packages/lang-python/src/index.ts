/**
 * Python language front end for testwitness: pytest and unittest.
 */
// @ts-nocheck

import type { FrameworkProfile, LanguageFrontEnd, TestInventory } from '@testwitness/core';
import { buildInventory } from './inventory.js';

export * from './frameworks.js';
export { buildInventory } from './inventory.js';
export { loadPythonGrammar, parsePython, pythonWasmPath } from './grammar.js';

const TEST_BASENAME = /^test_.*\.py$|_test\.py$/;
const TEST_DIR = /(^|\/)(tests?)\//;
const CONTENT_SNIFF = /^\s*(async\s+)?def\s+test_/m;

/** Decide whether a path (and optionally its content) is a Python test file. */
export function isPythonTestFile(path: string, source?: string): boolean {
  const normalised = path.replace(/\\/g, '/');
  if (!normalised.endsWith('.py')) return false;
  const base = normalised.slice(normalised.lastIndexOf('/') + 1);
  if (base === 'conftest.py') return false;
  if (TEST_BASENAME.test(base)) return true;
  if (TEST_DIR.test(normalised)) return true;
  if (source !== undefined && CONTENT_SNIFF.test(source)) return true;
  return false;
}

export const pythonFrontEnd: LanguageFrontEnd = {
  id: 'python',
  extensions: ['.py'],
  testGlobs: ['**/test_*.py', '**/*_test.py', '**/tests/**/*.py', '**/test/**/*.py'],
  isTestFile: isPythonTestFile,
  inventory(path: string, source: string, profile: FrameworkProfile): Promise<TestInventory> {
    return buildInventory(path, source, profile);
  },
};

export default pythonFrontEnd;
