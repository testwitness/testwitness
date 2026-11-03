/**
 * Java language front end for testwitness: JUnit 4, JUnit 5 and TestNG, with
 * AssertJ, Hamcrest, Truth, Mockito, Spring MockMvc, REST Assured and
 * Awaitility assertion shapes.
 */

import type { FrameworkProfile, LanguageFrontEnd, TestInventory } from '@testwitness/core';
import { buildJavaInventory } from './inventory.js';

export * from './frameworks.js';
export { loadJavaGrammar, javaWasmPath, queryPath, readQuerySource } from './grammar.js';
export { buildJavaInventory, countStatements, parameterCountOf, detectFramework } from './inventory.js';
export type { JavaInventoryResult, JavaTestTiming, SleepCall } from './inventory.js';

/** Spec R002 file name patterns plus the Maven and Gradle test source root. */
const TEST_FILE_NAME = /(Test|Tests|IT|TestCase)\.java$/;
const TEST_SOURCE_ROOT = /(^|\/)src\/test\//;
/** Content sniff for unusual paths: a JUnit or TestNG @Test annotation, qualified or not. */
const TEST_ANNOTATION = /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;

export function isJavaTestFile(path: string, source?: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (!p.endsWith('.java')) return false;
  if (TEST_FILE_NAME.test(p)) return true;
  if (TEST_SOURCE_ROOT.test(p)) return true;
  if (source !== undefined && TEST_ANNOTATION.test(source)) return true;
  return false;
}

export const javaFrontEnd: LanguageFrontEnd = {
  id: 'java',
  extensions: ['.java'],
  testGlobs: ['**/src/test/**/*.java', '**/*Test.java', '**/*Tests.java', '**/*IT.java', '**/*TestCase.java'],
  isTestFile: isJavaTestFile,
  async inventory(path: string, source: string, profile: FrameworkProfile): Promise<TestInventory> {
    const { inventory } = await buildJavaInventory(path, source, profile);
    return inventory;
  },
};

export default javaFrontEnd;
