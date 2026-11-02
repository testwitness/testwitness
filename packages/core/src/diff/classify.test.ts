import { describe, expect, it } from 'vitest';
import { classifyPath, languageOf, looksLikeTestSource } from './classify.js';

describe('classifyPath', () => {
  it.each([
    ['src/test/java/com/acme/FooTest.java', 'test', 'java'],
    ['src/main/java/com/acme/Foo.java', 'production', 'java'],
    ['src/billing.test.ts', 'test', 'typescript'],
    ['src/__tests__/billing.ts', 'test', 'typescript'],
    ['src/billing.ts', 'production', 'typescript'],
    ['e2e/checkout.spec.ts', 'test', 'typescript'],
    ['tests/test_billing.py', 'test', 'python'],
    ['app/billing.py', 'production', 'python'],
    ['tests/conftest.py', 'runner-config', 'python'],
    ['src/__snapshots__/table.test.tsx.snap', 'snapshot', undefined],
    ['testdata/out.golden', 'snapshot', undefined],
    ['.github/workflows/ci.yml', 'ci-workflow', undefined],
    ['.gitlab-ci.yml', 'ci-workflow', undefined],
    ['package.json', 'runner-config', undefined],
    ['jest.config.ts', 'runner-config', 'typescript'],
    ['pom.xml', 'runner-config', undefined],
    ['pnpm-lock.yaml', 'lockfile', undefined],
    ['codecov.yml', 'coverage-config', undefined],
    ['README.md', 'other', undefined],
  ])('%s is %s', (path, kind, language) => {
    const r = classifyPath(path, undefined);
    expect(r.kind).toBe(kind);
    expect(r.language).toBe(language);
  });

  it('sniffs content for tests in unusual paths', () => {
    expect(classifyPath('scripts/check.ts', "describe('x', () => { it('y', () => {}) })").kind).toBe('test');
    expect(classifyPath('scripts/check.ts', 'export const a = 1;').kind).toBe('production');
    expect(classifyPath('lib/Foo.java', '@Test void a() {}').kind).toBe('test');
    expect(classifyPath('lib/check.py', 'def test_a():\n  assert 1').kind).toBe('test');
  });

  it('honours ignore globs', () => {
    expect(classifyPath('gen/x.test.ts', undefined, { ignoreGlobs: ['gen/**'] }).kind).toBe('other');
  });

  it('honours custom test globs instead of defaults', () => {
    expect(classifyPath('checks/foo.check.ts', undefined, { testGlobs: ['**/*.check.ts'] }).kind).toBe('test');
    expect(classifyPath('src/foo.test.ts', undefined, { testGlobs: ['**/*.check.ts'] }).kind).toBe('production');
  });
});

describe('languageOf and looksLikeTestSource', () => {
  it('maps extensions', () => {
    expect(languageOf('a.tsx')).toBe('typescript');
    expect(languageOf('a.mjs')).toBe('javascript');
    expect(languageOf('a.rs')).toBeUndefined();
  });
  it('needs both describe and it for js', () => {
    expect(looksLikeTestSource('javascript', "describe('a', () => {})")).toBe(false);
  });
});
