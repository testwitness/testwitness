/**
 * TypeScript and JavaScript front end for testwitness.
 *
 * One LanguageFrontEnd object handles both languages: the grammar is picked
 * per file by extension (see grammar.ts) and the inventory reports
 * `language: 'javascript'` for .js, .mjs, .cjs and .jsx files.
 */
// @ts-nocheck

import type { FrameworkProfile, LanguageFrontEnd, TestInventory } from '@testwitness/core';
import { ALL_EXTENSIONS, JS_EXTENSIONS, TS_EXTENSIONS, TSX_EXTENSIONS, grammarForPath } from './grammar.js';
import { buildInventory } from './inventory.js';
import { FRAMEWORKS } from './frameworks.js';

export * from './frameworks.js';
export { buildInventory, countStatements, looksLikeTestName, QUALIFIED_NAME_SEPARATOR } from './inventory.js';
export { grammarForPath, grammarFor, languageFor, wasmPathFor, ALL_EXTENSIONS, TS_EXTENSIONS, TSX_EXTENSIONS, JS_EXTENSIONS } from './grammar.js';
export type { GrammarId } from './grammar.js';

const EXT_GROUP = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

export const TEST_GLOBS: string[] = [
  `**/*.test.${EXT_GROUP}`,
  `**/*.spec.${EXT_GROUP}`,
  `**/__tests__/**/*.${EXT_GROUP}`,
  `**/test/**/*.${EXT_GROUP}`,
  `**/tests/**/*.${EXT_GROUP}`,
  `**/e2e/**/*.${EXT_GROUP}`,
];

const TEST_PATH = /(\.(test|spec|e2e|integration)\.[cm]?[jt]sx?$)|((^|\/)(__tests__|__specs__|test|tests|spec|specs|e2e)\/)/;
const FRAMEWORK_IMPORT = /from\s+['"](vitest|@jest\/globals|mocha|chai|@playwright\/test|node:assert|assert|node:test)['"]|require\(\s*['"](vitest|@jest\/globals|mocha|chai|@playwright\/test|node:assert|assert|node:test)['"]\s*\)/;
const CONTAINER_CALL = /\b(describe|context|suite)(\.\w+)*\s*\(/;
const TEST_CALL = /\b(it|test|specify)(\.\w+)*\s*\(/;

function hasKnownExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return ALL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Path patterns per spec R002, plus a content sniff when the path is unusual. */
export function isTestFile(path: string, source?: string): boolean {
  if (!hasKnownExtension(path)) return false;
  const normalised = path.replace(/\\/g, '/');
  if (/\.d\.ts$/.test(normalised)) return false;
  if (TEST_PATH.test(normalised)) return true;
  if (source === undefined) return false;
  if (FRAMEWORK_IMPORT.test(source) && TEST_CALL.test(source)) return true;
  return CONTAINER_CALL.test(source) && TEST_CALL.test(source);
}

async function inventory(path: string, source: string, profile: FrameworkProfile): Promise<TestInventory> {
  return buildInventory(path, source, profile);
}

/** Front end for TypeScript files. It also parses JavaScript files handed to it. */
export const tsFrontEnd: LanguageFrontEnd = {
  id: 'typescript',
  extensions: [...TS_EXTENSIONS, ...TSX_EXTENSIONS, ...JS_EXTENSIONS],
  isTestFile,
  inventory,
  testGlobs: TEST_GLOBS,
};

/** Same implementation registered under the javascript id, for callers that route by language. */
export const jsFrontEnd: LanguageFrontEnd = {
  id: 'javascript',
  extensions: [...JS_EXTENSIONS],
  isTestFile,
  inventory,
  testGlobs: TEST_GLOBS,
};

export const frameworks = FRAMEWORKS;

/** Which language id a path resolves to under this front end. */
export function languageIdFor(path: string): 'typescript' | 'javascript' {
  return grammarForPath(path) === 'javascript' ? 'javascript' : 'typescript';
}
