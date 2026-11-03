/**
 * Framework tables for the Python front end: pytest and unittest.
 *
 * The tables name the imports that identify a framework, the skip and xfail
 * markers (spec 1.1, R001 to R010), the assertion sets (spec 1.2, A001) and
 * the A002 strength lattice. Strength is higher for stronger assertions
 * within one family; comparing across families is not meaningful.
 */
// @ts-nocheck

import type { AssertionKind } from '@testwitness/core';

export type PythonFramework = 'pytest' | 'unittest';

export interface MarkerSpec {
  /** Normalised marker name, for example `pytest.mark.skip`. */
  marker: string;
  /** Marker category when no condition is involved. */
  kind: 'skip' | 'xfail';
  /** True when the first positional argument is a condition to fold. */
  conditional: boolean;
  /** For skipUnless, the marker applies when the condition is false. */
  inverted?: boolean;
}

export interface LatticeEntry {
  family: string;
  strength: number;
}

export interface FrameworkTable {
  name: PythonFramework;
  /** Import roots whose presence selects this framework. */
  importSignals: string[];
  /** Decorator markers, keyed by the normalised last segments of the decorator. */
  markers: Record<string, MarkerSpec>;
  /** Calls that skip when they are the first statement of a test body. */
  skipCalls: string[];
  /** Assertion method names and their kinds. */
  assertions: Record<string, AssertionKind>;
  /** A002 lattice for assertion callees that belong to a known family. */
  lattice: Record<string, LatticeEntry>;
}

/** Family names used in the lattice. */
export const FAMILY_PYTEST_ASSERT = 'pytest.assert';
export const FAMILY_UNITTEST_EQUALITY = 'unittest.assert';
export const FAMILY_MOCK_CALLS = 'mock.calls';

/**
 * Lattice for bare `assert` shapes. Keys are synthetic shape names produced
 * by inventory.ts: `==` with a literal right hand side is the strongest, a
 * bare truthiness check the weakest.
 */
export const PYTEST_ASSERT_LATTICE: Record<string, LatticeEntry> = {
  'assert.==.literal': { family: FAMILY_PYTEST_ASSERT, strength: 5 },
  'assert.==': { family: FAMILY_PYTEST_ASSERT, strength: 4 },
  'assert.approx': { family: FAMILY_PYTEST_ASSERT, strength: 4 },
  'assert.compare': { family: FAMILY_PYTEST_ASSERT, strength: 3 },
  'assert.in': { family: FAMILY_PYTEST_ASSERT, strength: 3 },
  'assert.!=': { family: FAMILY_PYTEST_ASSERT, strength: 3 },
  'assert.is': { family: FAMILY_PYTEST_ASSERT, strength: 3 },
  'assert.isinstance': { family: FAMILY_PYTEST_ASSERT, strength: 2 },
  'assert.is-not-none': { family: FAMILY_PYTEST_ASSERT, strength: 2 },
  'assert.is-none': { family: FAMILY_PYTEST_ASSERT, strength: 2 },
  'assert.truthy': { family: FAMILY_PYTEST_ASSERT, strength: 1 },
  'assert.falsy': { family: FAMILY_PYTEST_ASSERT, strength: 1 },
};

/** Lattice for unittest `self.assert*` methods. */
export const UNITTEST_LATTICE: Record<string, LatticeEntry> = {
  assertEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertEquals: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertDictEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertListEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertTupleEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertSetEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertSequenceEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertMultiLineEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 5 },
  assertCountEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 4 },
  assertAlmostEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 4 },
  assertIs: { family: FAMILY_UNITTEST_EQUALITY, strength: 4 },
  assertRegex: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertIn: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertGreater: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertGreaterEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertLess: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertLessEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertNotEqual: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertNotIn: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertIsNot: { family: FAMILY_UNITTEST_EQUALITY, strength: 3 },
  assertIsInstance: { family: FAMILY_UNITTEST_EQUALITY, strength: 2 },
  assertIsNotNone: { family: FAMILY_UNITTEST_EQUALITY, strength: 2 },
  assertIsNone: { family: FAMILY_UNITTEST_EQUALITY, strength: 2 },
  assertTrue: { family: FAMILY_UNITTEST_EQUALITY, strength: 1 },
  assertFalse: { family: FAMILY_UNITTEST_EQUALITY, strength: 1 },
};

/** Lattice for unittest.mock call assertions on any receiver. */
export const MOCK_LATTICE: Record<string, LatticeEntry> = {
  assert_called_once_with: { family: FAMILY_MOCK_CALLS, strength: 5 },
  assert_awaited_once_with: { family: FAMILY_MOCK_CALLS, strength: 5 },
  assert_called_with: { family: FAMILY_MOCK_CALLS, strength: 4 },
  assert_awaited_with: { family: FAMILY_MOCK_CALLS, strength: 4 },
  assert_has_calls: { family: FAMILY_MOCK_CALLS, strength: 4 },
  assert_has_awaits: { family: FAMILY_MOCK_CALLS, strength: 4 },
  assert_any_call: { family: FAMILY_MOCK_CALLS, strength: 3 },
  assert_any_await: { family: FAMILY_MOCK_CALLS, strength: 3 },
  assert_called_once: { family: FAMILY_MOCK_CALLS, strength: 3 },
  assert_awaited_once: { family: FAMILY_MOCK_CALLS, strength: 3 },
  assert_not_called: { family: FAMILY_MOCK_CALLS, strength: 2 },
  assert_not_awaited: { family: FAMILY_MOCK_CALLS, strength: 2 },
  assert_called: { family: FAMILY_MOCK_CALLS, strength: 1 },
  assert_awaited: { family: FAMILY_MOCK_CALLS, strength: 1 },
};

/** Mock assertion method names, for interaction classification. */
export const MOCK_ASSERTION_METHODS = new Set(Object.keys(MOCK_LATTICE));

/** unittest assertion methods and their kinds. */
export const UNITTEST_ASSERTIONS: Record<string, AssertionKind> = {
  assertEqual: 'value',
  assertEquals: 'value',
  assertNotEqual: 'value',
  assertDictEqual: 'value',
  assertListEqual: 'value',
  assertTupleEqual: 'value',
  assertSetEqual: 'value',
  assertSequenceEqual: 'value',
  assertMultiLineEqual: 'value',
  assertCountEqual: 'value',
  assertAlmostEqual: 'value',
  assertNotAlmostEqual: 'value',
  assertIs: 'value',
  assertIsNot: 'value',
  assertIn: 'value',
  assertNotIn: 'value',
  assertRegex: 'value',
  assertNotRegex: 'value',
  assertGreater: 'value',
  assertGreaterEqual: 'value',
  assertLess: 'value',
  assertLessEqual: 'value',
  assertIsNone: 'value',
  assertIsNotNone: 'smoke',
  assertTrue: 'smoke',
  assertFalse: 'smoke',
  assertIsInstance: 'smoke',
  assertNotIsInstance: 'smoke',
  assertRaises: 'exception',
  assertRaisesRegex: 'exception',
  assertWarns: 'exception',
  assertWarnsRegex: 'exception',
  assertLogs: 'state',
  assertNoLogs: 'state',
  fail: 'value',
};

/** pytest context managers and calls that assert an exception or warning. */
export const PYTEST_EXCEPTION_CALLS = new Set(['pytest.raises', 'pytest.warns', 'pytest.deprecated_call']);

export const PYTEST_TABLE: FrameworkTable = {
  name: 'pytest',
  importSignals: ['pytest', '_pytest'],
  markers: {
    'mark.skip': { marker: 'pytest.mark.skip', kind: 'skip', conditional: false },
    'mark.skipif': { marker: 'pytest.mark.skipif', kind: 'skip', conditional: true },
    'mark.xfail': { marker: 'pytest.mark.xfail', kind: 'xfail', conditional: true },
  },
  skipCalls: ['pytest.skip', 'pytest.importorskip'],
  assertions: { assert: 'value' },
  lattice: PYTEST_ASSERT_LATTICE,
};

export const UNITTEST_TABLE: FrameworkTable = {
  name: 'unittest',
  importSignals: ['unittest'],
  markers: {
    skip: { marker: 'unittest.skip', kind: 'skip', conditional: false },
    skipIf: { marker: 'unittest.skipIf', kind: 'skip', conditional: true },
    skipUnless: { marker: 'unittest.skipUnless', kind: 'skip', conditional: true, inverted: true },
    expectedFailure: { marker: 'unittest.expectedFailure', kind: 'xfail', conditional: false },
  },
  skipCalls: ['self.skipTest', 'unittest.SkipTest', 'SkipTest'],
  assertions: UNITTEST_ASSERTIONS,
  lattice: { ...UNITTEST_LATTICE, ...MOCK_LATTICE },
};

export const FRAMEWORKS: FrameworkTable[] = [PYTEST_TABLE, UNITTEST_TABLE];

/** Look up a lattice entry across every table; undefined when not in a family. */
export function latticeFor(callee: string): LatticeEntry | undefined {
  return PYTEST_ASSERT_LATTICE[callee] ?? UNITTEST_LATTICE[callee] ?? MOCK_LATTICE[callee];
}

/**
 * Count the parameter cases of a `@pytest.mark.parametrize(argnames, argvalues)`
 * decorator from the argvalues node type and child count. Returns undefined
 * when argvalues is not a literal list or tuple.
 */
export function parametrizeCaseCount(valuesNodeType: string, namedChildCount: number): number | undefined {
  if (valuesNodeType === 'list' || valuesNodeType === 'tuple' || valuesNodeType === 'set') return namedChildCount;
  return undefined;
}
