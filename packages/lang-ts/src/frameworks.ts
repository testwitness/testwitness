/**
 * Framework tables for the TypeScript and JavaScript front end.
 *
 * Covers Jest, Vitest, Mocha (with Chai and Node assert) and Playwright Test.
 * The tables drive src/inventory.ts and are exported for rules that need to
 * reason about timeouts, sleeps, retries and the assertion strength lattice.
 */
// @ts-nocheck

import type { AssertionKind, SkipMarker } from '@testwitness/core';

export type FrameworkId = 'jest' | 'vitest' | 'mocha' | 'playwright';

export type MarkerKind = SkipMarker['kind'];

export interface ModifierInfo {
  /** Marker emitted by this modifier, undefined when the modifier is neutral (concurrent, sequential, serial). */
  marker?: MarkerKind;
  /**
   * How the marker condition is read when the modifier takes a call argument.
   * `skipIf(true)` folds to a constant skip, `runIf(false)` folds to a constant skip.
   */
  conditional?: 'skipIf' | 'runIf';
  /** The modifier takes a table and returns the declaration function (test.each(table)(title, fn)). */
  table?: boolean;
}

/** Modifiers shared by every framework. Not all of them exist in every framework but none clash. */
export const MODIFIERS: Record<string, ModifierInfo> = {
  skip: { marker: 'skip' },
  only: { marker: 'focus' },
  todo: { marker: 'todo' },
  fixme: { marker: 'fixme' },
  fails: { marker: 'xfail' },
  fail: { marker: 'xfail' },
  skipIf: { marker: 'conditional-skip', conditional: 'skipIf' },
  runIf: { marker: 'conditional-skip', conditional: 'runIf' },
  each: { table: true },
  for: { table: true },
  concurrent: {},
  sequential: {},
  serial: {},
  parallel: {},
  shuffle: {},
  extend: {},
};

/** Aliases that bake a marker into the root name. */
export const ROOT_ALIASES: Record<string, { base: 'test' | 'container'; marker?: MarkerKind }> = {
  it: { base: 'test' },
  test: { base: 'test' },
  specify: { base: 'test' },
  xit: { base: 'test', marker: 'skip' },
  xtest: { base: 'test', marker: 'skip' },
  xspecify: { base: 'test', marker: 'skip' },
  fit: { base: 'test', marker: 'focus' },
  ftest: { base: 'test', marker: 'focus' },
  fspecify: { base: 'test', marker: 'focus' },
  describe: { base: 'container' },
  context: { base: 'container' },
  suite: { base: 'container' },
  xdescribe: { base: 'container', marker: 'skip' },
  xcontext: { base: 'container', marker: 'skip' },
  xsuite: { base: 'container', marker: 'skip' },
  fdescribe: { base: 'container', marker: 'focus' },
  fcontext: { base: 'container', marker: 'focus' },
  fsuite: { base: 'container', marker: 'focus' },
};

export const TEST_ROOTS = Object.keys(ROOT_ALIASES).filter((k) => ROOT_ALIASES[k]?.base === 'test');
export const CONTAINER_ROOTS = Object.keys(ROOT_ALIASES).filter((k) => ROOT_ALIASES[k]?.base === 'container');

/** Properties on a test root that are hooks or utilities, never declarations. */
export const NON_DECLARATION_PROPERTIES = new Set([
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'step',
  'use',
  'info',
  'setTimeout',
  'slow',
  'configure',
  'extend',
  'expect',
]);

export interface LatticeEntry {
  family: string;
  strength: number;
  kind: AssertionKind;
}

/**
 * A002 strength lattice. Keyed by the terminal matcher name of the callee
 * chain (`toBe` in `expect.not.toBe`, `equal` in `expect.to.deep.equal`,
 * `strictEqual` in `assert.strictEqual`). Higher is stronger within a family.
 * Comparing strengths across families is not meaningful.
 *
 * Families:
 *   value         everything that asserts on a returned value, from exact
 *                 equality (4) through structural equality (3), containment,
 *                 shape, regex, length and ordering checks (2) down to defined,
 *                 truthy, null and type checks (1, the smoke end). One family
 *                 so that A002 can see toEqual become toMatchObject or toBe
 *                 become toBeDefined, the moves its documentation names. The
 *                 other front ends group families the same way (Python uses one
 *                 family per assertion style).
 *   interaction   mock and spy call checks
 *   exception     throws and rejects
 *   snapshot      snapshot matchers
 *   web           Playwright locator and page matchers
 *   count         expect.assertions and expect.hasAssertions
 */
export const MATCHER_LATTICE: Record<string, LatticeEntry> = {
  // Jest and Vitest equality
  toStrictEqual: { family: 'value', strength: 4, kind: 'value' },
  toBe: { family: 'value', strength: 3, kind: 'value' },
  toEqual: { family: 'value', strength: 3, kind: 'value' },
  toBeNull: { family: 'value', strength: 3, kind: 'value' },
  toBeUndefined: { family: 'value', strength: 3, kind: 'value' },
  toBeNaN: { family: 'value', strength: 3, kind: 'value' },
  // Jest and Vitest partial
  toMatchObject: { family: 'value', strength: 2, kind: 'value' },
  toContain: { family: 'value', strength: 2, kind: 'value' },
  toContainEqual: { family: 'value', strength: 2, kind: 'value' },
  toHaveLength: { family: 'value', strength: 2, kind: 'value' },
  toHaveProperty: { family: 'value', strength: 2, kind: 'value' },
  toMatch: { family: 'value', strength: 2, kind: 'value' },
  toBeOneOf: { family: 'value', strength: 1, kind: 'value' },
  toBeTypeOf: { family: 'value', strength: 1, kind: 'smoke' },
  // Jest and Vitest comparison
  toBeGreaterThan: { family: 'value', strength: 2, kind: 'value' },
  toBeGreaterThanOrEqual: { family: 'value', strength: 2, kind: 'value' },
  toBeLessThan: { family: 'value', strength: 2, kind: 'value' },
  toBeLessThanOrEqual: { family: 'value', strength: 2, kind: 'value' },
  toBeCloseTo: { family: 'value', strength: 2, kind: 'value' },
  // Jest and Vitest presence (smoke)
  toBeDefined: { family: 'value', strength: 1, kind: 'smoke' },
  toBeTruthy: { family: 'value', strength: 1, kind: 'smoke' },
  toBeFalsy: { family: 'value', strength: 1, kind: 'smoke' },
  toBeInstanceOf: { family: 'value', strength: 1, kind: 'smoke' },
  // Jest and Vitest interaction
  toHaveBeenCalledWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveBeenNthCalledWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveBeenLastCalledWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveBeenCalledExactlyOnceWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveBeenCalledTimes: { family: 'interaction', strength: 2, kind: 'interaction' },
  toHaveBeenCalledOnce: { family: 'interaction', strength: 2, kind: 'interaction' },
  toHaveBeenCalled: { family: 'interaction', strength: 1, kind: 'interaction' },
  toBeCalled: { family: 'interaction', strength: 1, kind: 'interaction' },
  toBeCalledWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toBeCalledTimes: { family: 'interaction', strength: 2, kind: 'interaction' },
  toHaveReturnedWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveLastReturnedWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveNthReturnedWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveReturnedTimes: { family: 'interaction', strength: 2, kind: 'interaction' },
  toHaveReturned: { family: 'interaction', strength: 1, kind: 'interaction' },
  toHaveResolvedWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  toHaveResolved: { family: 'interaction', strength: 1, kind: 'interaction' },
  // Jest and Vitest exception. Strength 1 with no argument, raised to 2 by the analyser when an argument narrows the error.
  toThrow: { family: 'exception', strength: 1, kind: 'exception' },
  toThrowError: { family: 'exception', strength: 1, kind: 'exception' },
  toThrowErrorMatchingSnapshot: { family: 'exception', strength: 2, kind: 'snapshot' },
  toThrowErrorMatchingInlineSnapshot: { family: 'exception', strength: 2, kind: 'snapshot' },
  // Snapshot
  toMatchInlineSnapshot: { family: 'snapshot', strength: 2, kind: 'snapshot' },
  toMatchSnapshot: { family: 'snapshot', strength: 1, kind: 'snapshot' },
  toMatchFileSnapshot: { family: 'snapshot', strength: 1, kind: 'snapshot' },
  toMatchImageSnapshot: { family: 'snapshot', strength: 1, kind: 'snapshot' },
  toHaveScreenshot: { family: 'snapshot', strength: 1, kind: 'snapshot' },
  // Playwright web first matchers
  toHaveText: { family: 'web', strength: 3, kind: 'state' },
  toHaveValue: { family: 'web', strength: 3, kind: 'state' },
  toHaveValues: { family: 'web', strength: 3, kind: 'state' },
  toHaveCount: { family: 'web', strength: 3, kind: 'state' },
  toHaveURL: { family: 'web', strength: 3, kind: 'state' },
  toHaveTitle: { family: 'web', strength: 3, kind: 'state' },
  toHaveAttribute: { family: 'web', strength: 2, kind: 'state' },
  toHaveClass: { family: 'web', strength: 2, kind: 'state' },
  toHaveCSS: { family: 'web', strength: 2, kind: 'state' },
  toHaveId: { family: 'web', strength: 2, kind: 'state' },
  toHaveJSProperty: { family: 'web', strength: 2, kind: 'state' },
  toHaveAccessibleName: { family: 'web', strength: 2, kind: 'state' },
  toHaveAccessibleDescription: { family: 'web', strength: 2, kind: 'state' },
  toHaveRole: { family: 'web', strength: 2, kind: 'state' },
  toContainText: { family: 'web', strength: 2, kind: 'state' },
  toBeChecked: { family: 'web', strength: 2, kind: 'state' },
  toBeVisible: { family: 'web', strength: 2, kind: 'state' },
  toBeHidden: { family: 'web', strength: 2, kind: 'state' },
  toBeEnabled: { family: 'web', strength: 2, kind: 'state' },
  toBeDisabled: { family: 'web', strength: 2, kind: 'state' },
  toBeEditable: { family: 'web', strength: 2, kind: 'state' },
  toBeEmpty: { family: 'web', strength: 2, kind: 'state' },
  toBeFocused: { family: 'web', strength: 2, kind: 'state' },
  toBeInViewport: { family: 'web', strength: 2, kind: 'state' },
  toBeAttached: { family: 'web', strength: 1, kind: 'state' },
  toBeOK: { family: 'web', strength: 1, kind: 'smoke' },
  // Count declarations
  assertions: { family: 'count', strength: 1, kind: 'smoke' },
  hasAssertions: { family: 'count', strength: 0, kind: 'smoke' },

  // Chai expect and should (terminal matcher names). `true`, `false`, `null`, `undefined`,
  // `ok`, `exist`, `empty` are property assertions with no call.
  equal: { family: 'value', strength: 3, kind: 'value' },
  equals: { family: 'value', strength: 3, kind: 'value' },
  eq: { family: 'value', strength: 3, kind: 'value' },
  eql: { family: 'value', strength: 3, kind: 'value' },
  eqls: { family: 'value', strength: 3, kind: 'value' },
  deepEqual: { family: 'value', strength: 3, kind: 'value' },
  true: { family: 'value', strength: 3, kind: 'value' },
  false: { family: 'value', strength: 3, kind: 'value' },
  null: { family: 'value', strength: 3, kind: 'value' },
  undefined: { family: 'value', strength: 3, kind: 'value' },
  NaN: { family: 'value', strength: 3, kind: 'value' },
  include: { family: 'value', strength: 2, kind: 'value' },
  includes: { family: 'value', strength: 2, kind: 'value' },
  contain: { family: 'value', strength: 2, kind: 'value' },
  contains: { family: 'value', strength: 2, kind: 'value' },
  members: { family: 'value', strength: 2, kind: 'value' },
  keys: { family: 'value', strength: 2, kind: 'value' },
  key: { family: 'value', strength: 2, kind: 'value' },
  property: { family: 'value', strength: 2, kind: 'value' },
  lengthOf: { family: 'value', strength: 2, kind: 'value' },
  length: { family: 'value', strength: 2, kind: 'value' },
  match: { family: 'value', strength: 2, kind: 'value' },
  matches: { family: 'value', strength: 2, kind: 'value' },
  string: { family: 'value', strength: 2, kind: 'value' },
  oneOf: { family: 'value', strength: 1, kind: 'value' },
  above: { family: 'value', strength: 2, kind: 'value' },
  gt: { family: 'value', strength: 2, kind: 'value' },
  greaterThan: { family: 'value', strength: 2, kind: 'value' },
  least: { family: 'value', strength: 2, kind: 'value' },
  gte: { family: 'value', strength: 2, kind: 'value' },
  below: { family: 'value', strength: 2, kind: 'value' },
  lt: { family: 'value', strength: 2, kind: 'value' },
  lessThan: { family: 'value', strength: 2, kind: 'value' },
  most: { family: 'value', strength: 2, kind: 'value' },
  lte: { family: 'value', strength: 2, kind: 'value' },
  within: { family: 'value', strength: 2, kind: 'value' },
  closeTo: { family: 'value', strength: 2, kind: 'value' },
  approximately: { family: 'value', strength: 2, kind: 'value' },
  ok: { family: 'value', strength: 1, kind: 'smoke' },
  exist: { family: 'value', strength: 1, kind: 'smoke' },
  exists: { family: 'value', strength: 1, kind: 'smoke' },
  empty: { family: 'value', strength: 1, kind: 'smoke' },
  a: { family: 'value', strength: 1, kind: 'smoke' },
  an: { family: 'value', strength: 1, kind: 'smoke' },
  instanceof: { family: 'value', strength: 1, kind: 'smoke' },
  instanceOf: { family: 'value', strength: 1, kind: 'smoke' },
  throw: { family: 'exception', strength: 1, kind: 'exception' },
  throws: { family: 'exception', strength: 1, kind: 'exception' },
  Throw: { family: 'exception', strength: 1, kind: 'exception' },
  rejectedWith: { family: 'exception', strength: 2, kind: 'exception' },
  rejected: { family: 'exception', strength: 1, kind: 'exception' },
  fulfilled: { family: 'value', strength: 1, kind: 'smoke' },
  // sinon-chai
  called: { family: 'interaction', strength: 1, kind: 'interaction' },
  calledOnce: { family: 'interaction', strength: 2, kind: 'interaction' },
  calledTwice: { family: 'interaction', strength: 2, kind: 'interaction' },
  calledThrice: { family: 'interaction', strength: 2, kind: 'interaction' },
  callCount: { family: 'interaction', strength: 2, kind: 'interaction' },
  calledWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  calledWithExactly: { family: 'interaction', strength: 3, kind: 'interaction' },
  calledOnceWith: { family: 'interaction', strength: 3, kind: 'interaction' },
  calledOnceWithExactly: { family: 'interaction', strength: 3, kind: 'interaction' },
  calledWithMatch: { family: 'interaction', strength: 2, kind: 'interaction' },
  calledBefore: { family: 'interaction', strength: 2, kind: 'interaction' },
  calledAfter: { family: 'interaction', strength: 2, kind: 'interaction' },
  returned: { family: 'interaction', strength: 3, kind: 'interaction' },

  // Node assert and Chai assert
  deepStrictEqual: { family: 'value', strength: 4, kind: 'value' },
  strictEqual: { family: 'value', strength: 3, kind: 'value' },
  notStrictEqual: { family: 'value', strength: 1, kind: 'value' },
  notDeepStrictEqual: { family: 'value', strength: 1, kind: 'value' },
  notEqual: { family: 'value', strength: 1, kind: 'value' },
  notDeepEqual: { family: 'value', strength: 1, kind: 'value' },
  isTrue: { family: 'value', strength: 3, kind: 'value' },
  isFalse: { family: 'value', strength: 3, kind: 'value' },
  isNull: { family: 'value', strength: 3, kind: 'value' },
  isUndefined: { family: 'value', strength: 3, kind: 'value' },
  isNaN: { family: 'value', strength: 3, kind: 'value' },
  isNotTrue: { family: 'value', strength: 1, kind: 'value' },
  isNotFalse: { family: 'value', strength: 1, kind: 'value' },
  deepInclude: { family: 'value', strength: 2, kind: 'value' },
  nestedInclude: { family: 'value', strength: 2, kind: 'value' },
  hasAllKeys: { family: 'value', strength: 2, kind: 'value' },
  hasAnyKeys: { family: 'value', strength: 1, kind: 'value' },
  containsAllKeys: { family: 'value', strength: 2, kind: 'value' },
  sameMembers: { family: 'value', strength: 2, kind: 'value' },
  sameDeepMembers: { family: 'value', strength: 2, kind: 'value' },
  includeMembers: { family: 'value', strength: 2, kind: 'value' },
  doesNotMatch: { family: 'value', strength: 1, kind: 'value' },
  isAbove: { family: 'value', strength: 2, kind: 'value' },
  isAtLeast: { family: 'value', strength: 2, kind: 'value' },
  isBelow: { family: 'value', strength: 2, kind: 'value' },
  isAtMost: { family: 'value', strength: 2, kind: 'value' },
  isOk: { family: 'value', strength: 1, kind: 'smoke' },
  isNotOk: { family: 'value', strength: 1, kind: 'smoke' },
  isNotNull: { family: 'value', strength: 1, kind: 'smoke' },
  isDefined: { family: 'value', strength: 1, kind: 'smoke' },
  isNotUndefined: { family: 'value', strength: 1, kind: 'smoke' },
  isNotEmpty: { family: 'value', strength: 1, kind: 'smoke' },
  isEmpty: { family: 'value', strength: 1, kind: 'smoke' },
  isArray: { family: 'value', strength: 1, kind: 'smoke' },
  isObject: { family: 'value', strength: 1, kind: 'smoke' },
  isString: { family: 'value', strength: 1, kind: 'smoke' },
  isNumber: { family: 'value', strength: 1, kind: 'smoke' },
  isBoolean: { family: 'value', strength: 1, kind: 'smoke' },
  isFunction: { family: 'value', strength: 1, kind: 'smoke' },
  typeOf: { family: 'value', strength: 1, kind: 'smoke' },
  notInstanceOf: { family: 'value', strength: 1, kind: 'smoke' },
  rejects: { family: 'exception', strength: 1, kind: 'exception' },
  doesNotThrow: { family: 'exception', strength: 0, kind: 'smoke' },
  doesNotReject: { family: 'exception', strength: 0, kind: 'smoke' },
  fail: { family: 'control', strength: 3, kind: 'value' },
  // bare assert(x) and assert.ok(x) share the smoke rung
  assert: { family: 'value', strength: 1, kind: 'smoke' },
};

/** Terminal names that are bare property assertions in Chai (no call parentheses). */
export const CHAI_PROPERTY_ASSERTIONS = new Set([
  'ok',
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'exist',
  'empty',
  'arguments',
  'extensible',
  'sealed',
  'frozen',
  'finite',
  'called',
  'calledOnce',
  'calledTwice',
  'calledThrice',
  'fulfilled',
  'rejected',
]);

/** Chai language chains that carry no meaning in the callee normalisation beyond readability. */
export const CHAI_LANGUAGE_CHAINS = new Set([
  'to',
  'be',
  'been',
  'is',
  'that',
  'which',
  'and',
  'has',
  'have',
  'with',
  'at',
  'of',
  'same',
  'but',
  'does',
  'still',
  'also',
]);

/** Chai flags that change strength. */
export const CHAI_FLAGS = new Set(['deep', 'nested', 'own', 'ordered', 'any', 'all', 'not', 'itself']);

export interface FrameworkTable {
  id: FrameworkId;
  /** Import sources that identify the framework. */
  importSources: string[];
  /** Global identifiers whose presence as a callee root suggests the framework (jest.*, vi.*). */
  globalRoots: string[];
  testNames: string[];
  containerNames: string[];
  /** Modifier names allowed on declarations in this framework. */
  modifiers: string[];
  /** Roots of assertion chains. */
  assertionRoots: string[];
  /** Mock declaration callees, as `root.prop`. */
  mockCalls: string[];
  /** Calls that change a timeout. */
  timeoutCalls: string[];
  /** Calls that sleep. */
  sleepCalls: string[];
  /** Calls or options that add retries. */
  retryCalls: string[];
}

const COMMON_SLEEPS = ['setTimeout', 'sleep', 'delay', 'wait', 'setImmediate', 'timers.setTimeout', 'timersPromises.setTimeout'];

export const FRAMEWORKS: FrameworkTable[] = [
  {
    id: 'jest',
    importSources: ['@jest/globals', 'jest', '@jest/expect', 'jest-extended'],
    globalRoots: ['jest'],
    testNames: ['it', 'test', 'xit', 'xtest', 'fit'],
    containerNames: ['describe', 'xdescribe', 'fdescribe'],
    modifiers: ['skip', 'only', 'todo', 'each', 'concurrent', 'failing'],
    assertionRoots: ['expect'],
    mockCalls: ['jest.mock', 'jest.doMock', 'jest.unstable_mockModule', 'jest.spyOn', 'jest.mocked', 'jest.fn'],
    timeoutCalls: ['jest.setTimeout', 'it(title, fn, timeout)', 'test(title, fn, timeout)'],
    sleepCalls: COMMON_SLEEPS,
    retryCalls: ['jest.retryTimes'],
  },
  {
    id: 'vitest',
    importSources: ['vitest', 'vitest/globals', '@vitest/expect'],
    globalRoots: ['vi'],
    testNames: ['it', 'test', 'xit', 'xtest', 'fit'],
    containerNames: ['describe', 'suite', 'xdescribe', 'fdescribe'],
    modifiers: ['skip', 'only', 'todo', 'fails', 'each', 'for', 'concurrent', 'sequential', 'shuffle', 'skipIf', 'runIf', 'extend'],
    assertionRoots: ['expect', 'assert', 'expectTypeOf', 'assertType'],
    mockCalls: ['vi.mock', 'vi.doMock', 'vi.spyOn', 'vi.mocked', 'vi.fn', 'vi.stubGlobal', 'vi.stubEnv'],
    timeoutCalls: ['vi.setConfig', 'it(title, fn, timeout)', 'test(title, { timeout }, fn)'],
    sleepCalls: COMMON_SLEEPS,
    retryCalls: ['test(title, { retry }, fn)', 'describe(title, { retry }, fn)'],
  },
  {
    id: 'mocha',
    importSources: ['mocha', 'chai', 'chai-as-promised', 'sinon-chai', 'assert', 'node:assert', 'node:assert/strict', 'assert/strict', 'sinon', 'should'],
    globalRoots: ['sinon', 'chai'],
    testNames: ['it', 'test', 'specify', 'xit', 'xspecify'],
    containerNames: ['describe', 'context', 'suite', 'xdescribe', 'xcontext'],
    modifiers: ['skip', 'only'],
    assertionRoots: ['expect', 'assert', 'should'],
    mockCalls: ['sinon.stub', 'sinon.spy', 'sinon.mock', 'sinon.replace', 'sinon.fake', 'sinon.createStubInstance'],
    timeoutCalls: ['this.timeout', 'this.slow'],
    sleepCalls: COMMON_SLEEPS,
    retryCalls: ['this.retries'],
  },
  {
    id: 'playwright',
    importSources: ['@playwright/test', 'playwright/test', '@playwright/experimental-ct-react', '@playwright/experimental-ct-vue'],
    globalRoots: [],
    testNames: ['test'],
    containerNames: ['test.describe'],
    modifiers: ['skip', 'only', 'fixme', 'fail', 'slow', 'serial', 'parallel', 'configure'],
    assertionRoots: ['expect'],
    mockCalls: [],
    timeoutCalls: ['test.setTimeout', 'test.slow', 'test.describe.configure({ timeout })'],
    sleepCalls: [...COMMON_SLEEPS, 'page.waitForTimeout'],
    retryCalls: ['test.describe.configure({ retries })'],
  },
];

export const FRAMEWORK_BY_ID: Record<FrameworkId, FrameworkTable> = Object.fromEntries(
  FRAMEWORKS.map((f) => [f.id, f]),
) as Record<FrameworkId, FrameworkTable>;

/** Detection order when several frameworks are imported in one file. */
export const FRAMEWORK_PRIORITY: FrameworkId[] = ['playwright', 'vitest', 'jest', 'mocha'];

export const DEFAULT_FRAMEWORK: FrameworkId = 'jest';

/**
 * Detect the framework for one file.
 *
 * Order: import sources, then global usage sniffed from the source text,
 * then the repository profile, then the language default (jest).
 */
export function detectFramework(imports: string[], source: string, profileFrameworks: Set<string>): FrameworkId {
  const importSet = new Set(imports);
  for (const id of FRAMEWORK_PRIORITY) {
    const table = FRAMEWORK_BY_ID[id];
    if (table.importSources.some((s) => importSet.has(s))) return id;
  }
  if (/\bvi\.(mock|fn|spyOn|useFakeTimers|mocked|stubGlobal|setConfig)\b/.test(source)) return 'vitest';
  if (/\bjest\.(mock|fn|spyOn|useFakeTimers|setTimeout|mocked|requireActual)\b/.test(source)) return 'jest';
  if (/\btest\.describe\s*\(|\btest\s*\(\s*(['"`][^'"`]*['"`])\s*,\s*async\s*\(\s*\{\s*page\b/.test(source)) return 'playwright';
  if (/\bthis\.(skip|timeout|retries)\s*\(|\.should\.|\bcontext\s*\(|\bspecify\s*\(|\bsuite\s*\(/.test(source)) return 'mocha';
  for (const id of FRAMEWORK_PRIORITY) {
    if (profileFrameworks.has(id)) return id;
  }
  return DEFAULT_FRAMEWORK;
}
