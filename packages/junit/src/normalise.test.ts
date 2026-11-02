import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classKey, inventoryKeys, nameKey, normaliseKey } from './normalise.js';

describe('nameKey', () => {
  it.each([
    ['test_a[1-2]', 'test_a'],
    ['test_a[some id-with-dash]', 'test_a'],
    ['method(int)[1]', 'method'],
    ['method()', 'method'],
    ['method[0](a, b)', 'method'],
    ['adds 1 + 1', 'adds 1 + 1'],
    ['  Spaced   Name ', 'spaced name'],
    ['[1] 1, 2', '[1] 1, 2'],
    ['flakyTest#2', 'flakytest'],
  ])('%s → %s', (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });
});

describe('classKey', () => {
  it('takes the last dotted segment keeping nested class separators', () => {
    expect(classKey('com.acme.FooTest')).toBe('footest');
    expect(classKey('com.acme.FooTest$Inner')).toBe('footest$inner');
    expect(classKey('tests.unit.test_billing.TestCharge')).toBe('testcharge');
  });
  it('uses the file stem when given a path', () => {
    expect(classKey('tests/billing.spec.ts')).toBe('billing');
    expect(classKey('src/__tests__/Billing.test.tsx')).toBe('billing');
    expect(classKey('tests\\test_x.py')).toBe('test_x');
  });
});

describe('inventoryKeys', () => {
  it('java maps Outer$Inner#method to surefire keys', () => {
    expect(inventoryKeys('src/test/java/com/acme/FooTest.java', 'FooTest$Inner#param', 'java')).toContain('footest$inner::param');
    expect(inventoryKeys('src/test/java/com/acme/FooTest.java', 'FooTest#adds', 'java')[0]).toBe('footest::adds');
  });
  it('python maps functions and methods', () => {
    expect(inventoryKeys('tests/test_x.py', 'test_a', 'python')).toEqual(['test_x::test_a']);
    expect(inventoryKeys('tests/test_x.py', 'TestK::test_a', 'python')).toEqual(['testk::test_a', 'test_x::test_a']);
  });
  it('typescript produces jest-junit, playwright and vitest shapes', () => {
    const keys = inventoryKeys('src/billing.test.ts', 'Billing › charge › rejects', 'typescript');
    expect(keys).toContain('billing charge rejects::billing charge rejects');
    expect(keys).toContain('billing charge::rejects');
    expect(keys).toContain('billing::billing › charge › rejects');
    expect(keys).toContain('billing::billing > charge > rejects');
    expect(keys).toContain('billing::rejects');
  });
  it('round trips: a pytest testcase normalises to one of the inventory keys (property)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^test_[a-z_]{1,10}$/), fc.stringMatching(/^[a-z0-9-]{0,8}$/), (fn, param) => {
        const xmlName = param ? `${fn}[${param}]` : fn;
        const key = normaliseKey('tests.test_mod', xmlName);
        expect(inventoryKeys('tests/test_mod.py', fn, 'python')).toContain(key);
      }),
    );
  });
});
