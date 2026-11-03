// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { FRAMEWORKS, FRAMEWORK_BY_ID, MATCHER_LATTICE, detectFramework, isTestFile, jsFrontEnd, languageIdFor, tsFrontEnd } from './index.js';
import { emptyProfile } from './helpers.test-util.js';

describe('front end object', () => {
  it('exposes the contract fields', () => {
    expect(tsFrontEnd.id).toBe('typescript');
    expect(tsFrontEnd.extensions).toContain('.ts');
    expect(tsFrontEnd.extensions).toContain('.js');
    expect(tsFrontEnd.testGlobs.length).toBeGreaterThan(0);
    expect(jsFrontEnd.id).toBe('javascript');
    expect(jsFrontEnd.extensions).not.toContain('.ts');
    expect(languageIdFor('a.js')).toBe('javascript');
    expect(languageIdFor('a.tsx')).toBe('typescript');
  });

  it('builds an inventory through the front end', async () => {
    const inventory = await tsFrontEnd.inventory('src/a.test.ts', "test('x', () => { expect(1).toBe(1); });", emptyProfile);
    expect(inventory.path).toBe('src/a.test.ts');
    expect(inventory.tests).toHaveLength(1);
    const js = await jsFrontEnd.inventory('src/a.test.js', "test('x', () => { expect(1).toBe(1); });", emptyProfile);
    expect(js.language).toBe('javascript');
  });
});

describe('isTestFile', () => {
  it('accepts the conventional path patterns', () => {
    for (const p of [
      'src/a.test.ts',
      'src/a.spec.tsx',
      'src/a.test.mjs',
      'src/__tests__/a.ts',
      'test/a.js',
      'tests/unit/a.cjs',
      'e2e/login.spec.ts',
      'src/a.e2e.ts',
      'src\\__tests__\\a.ts',
    ]) {
      expect(isTestFile(p), p).toBe(true);
    }
  });

  it('rejects production files, declaration files and other languages', () => {
    for (const p of ['src/a.ts', 'src/billing.js', 'src/a.test.py', 'src/a.test.d.ts', 'README.md', 'test/a.json']) {
      expect(isTestFile(p), p).toBe(false);
    }
  });

  it('sniffs content for unusual paths', () => {
    expect(isTestFile('src/checks.ts', "describe('x', () => { it('y', () => {}); });")).toBe(true);
    expect(isTestFile('src/checks.ts', "import { test } from 'vitest';\ntest('y', () => {});")).toBe(true);
    expect(isTestFile('src/checks.ts', 'export const it = 1;')).toBe(false);
    expect(isTestFile('src/checks.ts')).toBe(false);
  });
});

describe('framework tables', () => {
  it('lists the four frameworks with their tables', () => {
    expect(FRAMEWORKS.map((f) => f.id)).toEqual(['jest', 'vitest', 'mocha', 'playwright']);
    expect(FRAMEWORK_BY_ID.mocha.assertionRoots).toContain('should');
    expect(FRAMEWORK_BY_ID.playwright.sleepCalls).toContain('page.waitForTimeout');
    expect(FRAMEWORK_BY_ID.jest.retryCalls).toContain('jest.retryTimes');
    expect(FRAMEWORK_BY_ID.vitest.modifiers).toContain('skipIf');
  });

  it('keeps the lattice ordered within families', () => {
    const s = (m: string) => MATCHER_LATTICE[m]!.strength;
    expect(s('toStrictEqual')).toBeGreaterThan(s('toEqual'));
    expect(s('toEqual')).toBeGreaterThan(s('toMatchObject'));
    expect(s('toMatchObject')).toBeGreaterThan(s('toBeDefined'));
    expect(s('toHaveBeenCalledWith')).toBeGreaterThan(s('toHaveBeenCalledTimes'));
    expect(s('toHaveBeenCalledTimes')).toBeGreaterThan(s('toHaveBeenCalled'));
    expect(s('toMatchInlineSnapshot')).toBeGreaterThan(s('toMatchSnapshot'));
    expect(s('deepStrictEqual')).toBeGreaterThan(s('strictEqual'));
    expect(s('strictEqual')).toBeGreaterThan(s('ok'));
    expect(MATCHER_LATTICE.toBeTruthy!.kind).toBe('smoke');
    expect(MATCHER_LATTICE.toThrow!.kind).toBe('exception');
  });

  it('detects frameworks from imports, usage, profile and default in that order', () => {
    expect(detectFramework(['vitest'], '', new Set())).toBe('vitest');
    expect(detectFramework(['@playwright/test', 'vitest'], '', new Set())).toBe('playwright');
    expect(detectFramework(['chai'], '', new Set())).toBe('mocha');
    expect(detectFramework(['@jest/globals'], '', new Set())).toBe('jest');
    expect(detectFramework([], "jest.mock('x')", new Set())).toBe('jest');
    expect(detectFramework([], 'it("x", function () { this.timeout(5); })', new Set())).toBe('mocha');
    expect(detectFramework([], '', new Set(['mocha']))).toBe('mocha');
    expect(detectFramework([], '', new Set(['vitest', 'jest']))).toBe('vitest');
    expect(detectFramework([], '', new Set())).toBe('jest');
  });
});
