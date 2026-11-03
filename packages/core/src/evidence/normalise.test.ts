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
    // Real producer strings (fixtures/JUNIT-FIXTURES.md)
    ['sizeMatchesPushes[0: pushes=1]', 'sizematchespushes'], // Gradle, JUnit 4 Parameterized
    ['appliesRates[0](100.0, 0.0, 100.0)', 'appliesrates'], // Gradle, TestNG DataProvider
    ['test_add_parametrized[with space/slash]', 'test_add_parametrized'], // pytest
    ['test_add_parametrized[\\xfcn\\xefcode[brackets]]', 'test_add_parametrized'], // pytest, nested brackets
    ['Cart > applyDiscount > applyDiscount(100, 10) -> 90', 'cart applydiscount applydiscount(100, 10) -> 90'], // vitest
    ['Cart > total > sums line items', 'cart total sums line items'], // vitest
    ['pricing › parses a dollar amount', 'pricing parses a dollar amount'], // playwright
    ['Text slugify lowercases and joins with dashes', 'text slugify lowercases and joins with dashes'], // mocha
    ['Billing charge adds 1 and 2 to get 3', 'billing charge adds 1 and 2 to get 3'], // jest-junit default
  ])('%s → %s', (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });
  it('does not strip an unbalanced trailing bracket', () => {
    expect(nameKey('weird]')).toBe('weird]');
    expect(nameKey('also)')).toBe('also)');
  });
});

describe('classKey', () => {
  it('takes the last dotted segment keeping nested class separators', () => {
    expect(classKey('com.acme.FooTest')).toBe('footest');
    expect(classKey('com.acme.FooTest$Inner')).toBe('footest$inner');
    expect(classKey('tests.unit.test_billing.TestCharge')).toBe('testcharge');
    expect(classKey('demo.StackSizeTest')).toBe('stacksizetest'); // Gradle
    expect(classKey('tests.test_inventory')).toBe('test_inventory'); // pytest function
    expect(classKey('tests.test_shapes.ShapesTest')).toBe('shapestest'); // pytest unittest and xmlrunner
  });
  it('uses the file stem when given a path', () => {
    expect(classKey('tests/billing.spec.ts')).toBe('billing');
    expect(classKey('src/__tests__/Billing.test.tsx')).toBe('billing');
    expect(classKey('tests\\test_x.py')).toBe('test_x');
    expect(classKey('src/cart.test.ts')).toBe('cart'); // vitest
    expect(classKey('unit.spec.ts')).toBe('unit'); // playwright
  });
  it('collapses describe chain separators in a jest-junit custom classname', () => {
    expect(classKey('Billing › charge')).toBe('billing charge'); // jest-junit JEST_JUNIT_ANCESTOR_SEPARATOR=" › "
    expect(classKey('Billing charge charges a valid card')).toBe('billing charge charges a valid card'); // jest-junit default
    expect(classKey('lowercases and joins with dashes')).toBe('lowercases and joins with dashes'); // mocha inverted
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
  it('typescript produces jest-junit, playwright, vitest and mocha shapes', () => {
    const keys = inventoryKeys('src/billing.test.ts', 'Billing › charge › rejects', 'typescript');
    expect(keys).toContain('billing charge rejects::billing charge rejects');
    expect(keys).toContain('billing charge::rejects');
    expect(keys).toContain('billing::billing charge rejects');
    expect(keys).toContain('billing::rejects');
    expect(keys).toContain('rejects::billing charge rejects');
  });

  describe('real producer testcases join to the inventory', () => {
    const cases: Array<[producer: string, classname: string, name: string, path: string, qualifiedName: string, lang: 'java' | 'typescript' | 'javascript' | 'python']> = [
      ['Gradle JUnit 4', 'demo.StackTest', 'pushIncreasesSize', 'src/test/java/demo/StackTest.java', 'StackTest#pushIncreasesSize', 'java'],
      ['Gradle JUnit 4 Parameterized', 'demo.StackSizeTest', 'sizeMatchesPushes[1: pushes=2]', 'src/test/java/demo/StackSizeTest.java', 'StackSizeTest#sizeMatchesPushes', 'java'],
      ['Gradle TestNG DataProvider', 'demo.PricingTest', 'appliesRates[2](19.99, 0.25, 24.99)', 'src/test/java/demo/PricingTest.java', 'PricingTest#appliesRates', 'java'],
      ['TestNG JUnitReportReporter', 'demo.PricingTest', 'appliesRates', 'src/test/java/demo/PricingTest.java', 'PricingTest#appliesRates', 'java'],
      ['jest-junit default', 'Billing charge rejects expired cards', 'Billing charge rejects expired cards', 'src/billing.test.js', 'Billing › charge › rejects expired cards', 'javascript'],
      ['jest-junit titles', 'Billing › charge', 'rejects expired cards', 'src/billing.test.js', 'Billing › charge › rejects expired cards', 'javascript'],
      ['jest-junit titles, one describe', 'Billing › formatInvoice', 'matches the invoice snapshot', 'src/billing.test.js', 'Billing › formatInvoice › matches the invoice snapshot', 'javascript'],
      ['vitest', 'src/cart.test.ts', 'Cart > total > sums line items', 'src/cart.test.ts', 'Cart › total › sums line items', 'typescript'],
      ['vitest each row', 'src/cart.test.ts', 'Cart > applyDiscount > applyDiscount(100, 10) -> 90', 'src/cart.test.ts', 'Cart › applyDiscount › applyDiscount(100, 10) -> 90', 'typescript'],
      ['playwright', 'unit.spec.ts', 'pricing › parses a dollar amount', 'tests/unit.spec.ts', 'pricing › parses a dollar amount', 'typescript'],
      ['playwright no describe', 'unit.spec.ts', 'expected to fail', 'tests/unit.spec.ts', 'expected to fail', 'typescript'],
      ['mocha-junit-reporter', 'lowercases and joins with dashes', 'Text slugify lowercases and joins with dashes', 'test/lib.test.js', 'Text › slugify › lowercases and joins with dashes', 'javascript'],
      ['mocha-junit-reporter one describe', 'clamps below the range', 'Numbers clamps below the range', 'test/lib.test.js', 'Numbers › clamps below the range', 'javascript'],
      ['pytest function', 'tests.test_inventory', 'test_add_increases_count', 'tests/test_inventory.py', 'test_add_increases_count', 'python'],
      ['pytest parametrised', 'tests.test_inventory', 'test_add_parametrized[with space/slash]', 'tests/test_inventory.py', 'test_add_parametrized', 'python'],
      ['pytest parametrised nested brackets', 'tests.test_inventory', 'test_add_parametrized[\\xfcn\\xefcode[brackets]]', 'tests/test_inventory.py', 'test_add_parametrized', 'python'],
      ['pytest class method', 'tests.test_inventory.TestInventoryClass', 'test_rejects_non_positive', 'tests/test_inventory.py', 'TestInventoryClass::test_rejects_non_positive', 'python'],
      ['pytest unittest', 'tests.test_shapes.ShapesTest', 'test_circle_area', 'tests/test_shapes.py', 'ShapesTest::test_circle_area', 'python'],
      ['xmlrunner', 'tests.test_shapes.EdgeCasesTest', 'test_zero_radius', 'tests/test_shapes.py', 'EdgeCasesTest::test_zero_radius', 'python'],
    ];
    it.each(cases)('%s', (_producer, classname, name, path, qualifiedName, lang) => {
      expect(inventoryKeys(path, qualifiedName, lang)).toContain(normaliseKey(classname, name));
    });
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
  it('round trips: a describe chain normalises the same through jest-junit, vitest, playwright and mocha shapes (property)', () => {
    const word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 3 }), fc.array(word, { minLength: 1, maxLength: 3 }), (describes, titleWords) => {
        const title = titleWords.join(' ');
        const qn = [...describes, title].join(' › ');
        const keys = inventoryKeys('src/x.test.ts', qn, 'typescript');
        expect(keys).toContain(normaliseKey([...describes, title].join(' '), [...describes, title].join(' '))); // jest-junit default
        expect(keys).toContain(normaliseKey(describes.join(' › '), title)); // jest-junit titles
        expect(keys).toContain(normaliseKey('src/x.test.ts', [...describes, title].join(' > '))); // vitest
        expect(keys).toContain(normaliseKey('x.test.ts', [...describes, title].join(' › '))); // playwright
        expect(keys).toContain(normaliseKey(title, [...describes, title].join(' '))); // mocha
      }),
    );
  });
});
