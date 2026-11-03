// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { isPythonTestFile, pythonFrontEnd } from './index.js';
import { FRAMEWORKS, latticeFor, parametrizeCaseCount } from './frameworks.js';
import { loadPythonGrammar, readQuerySource } from './grammar.js';

describe('isTestFile', () => {
  it('accepts test_*.py and *_test.py anywhere', () => {
    expect(isPythonTestFile('src/app/test_billing.py')).toBe(true);
    expect(isPythonTestFile('src/app/billing_test.py')).toBe(true);
    expect(isPythonTestFile('test_billing.py')).toBe(true);
  });

  it('accepts any .py under tests/ or test/', () => {
    expect(isPythonTestFile('tests/billing.py')).toBe(true);
    expect(isPythonTestFile('pkg/test/unit/billing.py')).toBe(true);
    expect(isPythonTestFile('pkg/testing/billing.py')).toBe(false);
  });

  it('rejects conftest.py even inside tests/', () => {
    expect(isPythonTestFile('tests/conftest.py')).toBe(false);
    expect(isPythonTestFile('conftest.py')).toBe(false);
  });

  it('rejects non Python files and production modules', () => {
    expect(isPythonTestFile('tests/data.json')).toBe(false);
    expect(isPythonTestFile('app/billing.py')).toBe(false);
    expect(isPythonTestFile('app/testing_utils.py')).toBe(false);
  });

  it('sniffs content for def test_ when the path is unusual', () => {
    expect(isPythonTestFile('app/checks.py', 'import x\n\ndef test_thing():\n    assert x\n')).toBe(true);
    expect(isPythonTestFile('app/checks.py', 'async def test_thing():\n    pass\n')).toBe(true);
    expect(isPythonTestFile('app/checks.py', 'def thing():\n    pass\n')).toBe(false);
    expect(isPythonTestFile('app/checks.py', 'class X:\n    def test_a(self):\n        pass\n')).toBe(true);
  });

  it('exposes the front end contract', () => {
    expect(pythonFrontEnd.id).toBe('python');
    expect(pythonFrontEnd.extensions).toEqual(['.py']);
    expect(pythonFrontEnd.testGlobs).toContain('**/test_*.py');
    expect(pythonFrontEnd.isTestFile).toBe(isPythonTestFile);
  });
});

describe('framework tables', () => {
  it('names pytest and unittest', () => {
    expect(FRAMEWORKS.map((f) => f.name)).toEqual(['pytest', 'unittest']);
  });

  it('orders the lattices as the spec requires', () => {
    const s = (k: string) => latticeFor(k)!.strength;
    expect(s('assert.==.literal')).toBeGreaterThan(s('assert.is-not-none'));
    expect(s('assert.is-not-none')).toBeGreaterThan(s('assert.truthy'));
    expect(s('assertEqual')).toBeGreaterThan(s('assertIsNotNone'));
    expect(s('assertIsNotNone')).toBeGreaterThan(s('assertTrue'));
    expect(s('assert_called_once_with')).toBeGreaterThan(s('assert_called_once'));
    expect(s('assert_called_once')).toBeGreaterThan(s('assert_called'));
    expect(latticeFor('fail')).toBeUndefined();
    expect(latticeFor('nothing')).toBeUndefined();
  });

  it('counts parametrize cases only for literal collections', () => {
    expect(parametrizeCaseCount('list', 3)).toBe(3);
    expect(parametrizeCaseCount('tuple', 2)).toBe(2);
    expect(parametrizeCaseCount('identifier', 0)).toBeUndefined();
    expect(parametrizeCaseCount('call', 0)).toBeUndefined();
  });
});

describe('grammar', () => {
  it('loads the language and compiles all four queries once', async () => {
    const a = await loadPythonGrammar();
    const b = await loadPythonGrammar();
    expect(a).toBe(b);
    expect(Object.keys(a.queries).sort()).toEqual(['assertions', 'markers', 'mocks', 'tests']);
    for (const name of ['tests', 'assertions', 'markers', 'mocks'] as const) {
      expect(readQuerySource(name).length).toBeGreaterThan(0);
    }
  });
});
