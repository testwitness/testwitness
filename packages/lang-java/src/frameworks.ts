/**
 * Framework tables for the Java front end: JUnit 5, JUnit 4 and TestNG, plus
 * the assertion libraries that live alongside them (AssertJ, Hamcrest, Truth,
 * Mockito, Spring MockMvc, REST Assured, Awaitility).
 *
 * Everything here is data. The logic that applies it lives in inventory.ts.
 */
import type { AssertionKind } from '@testwitness/core';

export type JavaFramework = 'junit5' | 'junit4' | 'testng';

export type MarkerKind = 'skip' | 'focus' | 'todo' | 'fixme' | 'xfail' | 'conditional-skip';

export interface SkipAnnotationRule {
  /** Simple annotation name, for example `Disabled`. */
  name: string;
  kind: MarkerKind;
  /** The marker is unconditional (no condition to evaluate). */
  constant: boolean;
}

export interface FrameworkTable {
  name: JavaFramework;
  /** Import prefixes that identify the framework. */
  importPrefixes: string[];
  /** Import prefixes that must NOT be matched (JUnit 4 shares `org.junit.`). */
  importExcludes: string[];
  /** Annotations that make a method a test. */
  testAnnotations: string[];
  /** Lifecycle and helper annotations: never tests, never assertion helpers. */
  lifecycleAnnotations: string[];
  /** Annotations that make a class or method skipped. */
  skipAnnotations: SkipAnnotationRule[];
  /** `@Test(key = false)` style skip: key and the value that means skipped. */
  testAttributeSkip?: { key: string; skippedWhen: string };
  /** `@Test(key = X.class)` style exception expectation. */
  expectedExceptionKeys: string[];
  /** `@Test(key = 500)` style timeout attribute, milliseconds. */
  timeoutAttribute?: string;
  /** Standalone timeout annotation, seconds by default (`@Timeout(5)`). */
  timeoutAnnotation?: string;
  /** Assumption calls that skip when the condition folds to a constant. */
  assumptions: string[];
  /** Annotations that provide countable parameter cases, with the counting mode. */
  parameterSources: Record<string, 'literal' | 'dynamic' | 'enum'>;
  /** Default assertion family for bare assert* calls. */
  assertionFamily: string;
  /** Position of the actual value in `assertEquals` style calls. */
  actualArgument: 'second' | 'first';
  /** Where a message argument sits when present. */
  messagePosition: 'first' | 'last';
}

const junitLifecycle = ['BeforeEach', 'AfterEach', 'BeforeAll', 'AfterAll', 'Before', 'After', 'BeforeClass', 'AfterClass', 'Rule', 'ClassRule', 'RegisterExtension'];

export const junit5: FrameworkTable = {
  name: 'junit5',
  importPrefixes: ['org.junit.jupiter.', 'org.junit.platform.'],
  importExcludes: [],
  testAnnotations: ['Test', 'ParameterizedTest', 'RepeatedTest', 'TestFactory', 'TestTemplate'],
  lifecycleAnnotations: junitLifecycle,
  skipAnnotations: [
    { name: 'Disabled', kind: 'skip', constant: true },
    { name: 'DisabledIf', kind: 'conditional-skip', constant: false },
    { name: 'DisabledOnOs', kind: 'conditional-skip', constant: false },
    { name: 'DisabledOnJre', kind: 'conditional-skip', constant: false },
    { name: 'DisabledForJreRange', kind: 'conditional-skip', constant: false },
    { name: 'DisabledIfSystemProperty', kind: 'conditional-skip', constant: false },
    { name: 'DisabledIfSystemProperties', kind: 'conditional-skip', constant: false },
    { name: 'DisabledIfEnvironmentVariable', kind: 'conditional-skip', constant: false },
    { name: 'DisabledIfEnvironmentVariables', kind: 'conditional-skip', constant: false },
    { name: 'DisabledInNativeImage', kind: 'conditional-skip', constant: false },
    { name: 'EnabledIf', kind: 'conditional-skip', constant: false },
    { name: 'EnabledOnOs', kind: 'conditional-skip', constant: false },
    { name: 'EnabledOnJre', kind: 'conditional-skip', constant: false },
    { name: 'EnabledForJreRange', kind: 'conditional-skip', constant: false },
    { name: 'EnabledIfSystemProperty', kind: 'conditional-skip', constant: false },
    { name: 'EnabledIfEnvironmentVariable', kind: 'conditional-skip', constant: false },
    { name: 'EnabledInNativeImage', kind: 'conditional-skip', constant: false },
  ],
  expectedExceptionKeys: [],
  timeoutAnnotation: 'Timeout',
  assumptions: ['assumeTrue', 'assumeFalse', 'assumingThat', 'abort'],
  parameterSources: {
    ValueSource: 'literal',
    CsvSource: 'literal',
    EnumSource: 'enum',
    NullSource: 'literal',
    EmptySource: 'literal',
    NullAndEmptySource: 'literal',
    MethodSource: 'dynamic',
    FieldSource: 'dynamic',
    CsvFileSource: 'dynamic',
    ArgumentsSource: 'dynamic',
    ArgumentsSources: 'dynamic',
  },
  assertionFamily: 'junit',
  actualArgument: 'second',
  messagePosition: 'last',
};

export const junit4: FrameworkTable = {
  name: 'junit4',
  importPrefixes: ['org.junit.'],
  importExcludes: ['org.junit.jupiter.', 'org.junit.platform.'],
  testAnnotations: ['Test', 'Theory'],
  lifecycleAnnotations: junitLifecycle,
  skipAnnotations: [{ name: 'Ignore', kind: 'skip', constant: true }],
  expectedExceptionKeys: ['expected'],
  timeoutAttribute: 'timeout',
  assumptions: ['assumeTrue', 'assumeFalse', 'assumeThat', 'assumeNoException', 'assumeNotNull'],
  parameterSources: {},
  assertionFamily: 'junit',
  actualArgument: 'second',
  messagePosition: 'first',
};

export const testng: FrameworkTable = {
  name: 'testng',
  importPrefixes: ['org.testng.'],
  importExcludes: [],
  testAnnotations: ['Test'],
  lifecycleAnnotations: ['BeforeMethod', 'AfterMethod', 'BeforeClass', 'AfterClass', 'BeforeTest', 'AfterTest', 'BeforeSuite', 'AfterSuite', 'BeforeGroups', 'AfterGroups', 'DataProvider', 'Factory'],
  skipAnnotations: [{ name: 'Ignore', kind: 'skip', constant: true }],
  testAttributeSkip: { key: 'enabled', skippedWhen: 'false' },
  expectedExceptionKeys: ['expectedExceptions'],
  timeoutAttribute: 'timeOut',
  assumptions: [],
  parameterSources: { DataProvider: 'dynamic', Parameters: 'dynamic' },
  assertionFamily: 'testng',
  actualArgument: 'first',
  messagePosition: 'last',
};

export const frameworkTables: FrameworkTable[] = [junit5, junit4, testng];

export const DEFAULT_FRAMEWORK: JavaFramework = 'junit5';

/* ------------------------------------------------------------------------ */
/* A001 assertion sets and A002 strength lattice                              */
/* ------------------------------------------------------------------------ */

export interface AssertionShape {
  kind: AssertionKind;
  strength: number;
}

/**
 * JUnit 4, JUnit 5 and TestNG `Assert` / `Assertions` static methods.
 * Strength: 1 smoke, 2 boolean or null checks, 3 inequality or type, 4 equality.
 */
export const junitAssertions: Record<string, AssertionShape> = {
  assertEquals: { kind: 'value', strength: 4 },
  assertNotEquals: { kind: 'value', strength: 3 },
  assertSame: { kind: 'value', strength: 4 },
  assertNotSame: { kind: 'value', strength: 3 },
  assertArrayEquals: { kind: 'value', strength: 4 },
  assertIterableEquals: { kind: 'value', strength: 4 },
  assertLinesMatch: { kind: 'value', strength: 4 },
  assertEqualsDeep: { kind: 'value', strength: 4 },
  assertEqualsNoOrder: { kind: 'value', strength: 4 },
  assertTrue: { kind: 'value', strength: 2 },
  assertFalse: { kind: 'value', strength: 2 },
  assertNull: { kind: 'value', strength: 2 },
  assertNotNull: { kind: 'smoke', strength: 1 },
  assertInstanceOf: { kind: 'smoke', strength: 1 },
  assertAll: { kind: 'value', strength: 3 },
  assertThrows: { kind: 'exception', strength: 3 },
  assertThrowsExactly: { kind: 'exception', strength: 4 },
  expectThrows: { kind: 'exception', strength: 3 },
  assertDoesNotThrow: { kind: 'smoke', strength: 1 },
  assertTimeout: { kind: 'value', strength: 2 },
  assertTimeoutPreemptively: { kind: 'value', strength: 2 },
  fail: { kind: 'value', strength: 1 },
};

/** AssertJ terminal methods on an `assertThat(x)` chain. Unknown terminals get strength 2. */
export const assertjTerminals: Record<string, AssertionShape> = {
  isNotNull: { kind: 'smoke', strength: 1 },
  isInstanceOf: { kind: 'smoke', strength: 1 },
  isInstanceOfAny: { kind: 'smoke', strength: 1 },
  isExactlyInstanceOf: { kind: 'smoke', strength: 1 },
  isPresent: { kind: 'smoke', strength: 1 },
  isNotEmpty: { kind: 'smoke', strength: 1 },
  isNotBlank: { kind: 'smoke', strength: 1 },
  doesNotThrowAnyException: { kind: 'smoke', strength: 1 },
  isTrue: { kind: 'value', strength: 2 },
  isFalse: { kind: 'value', strength: 2 },
  isNull: { kind: 'value', strength: 2 },
  isEmpty: { kind: 'value', strength: 2 },
  isNotPresent: { kind: 'value', strength: 2 },
  contains: { kind: 'value', strength: 2 },
  containsKey: { kind: 'value', strength: 2 },
  containsEntry: { kind: 'value', strength: 2 },
  containsAnyOf: { kind: 'value', strength: 2 },
  doesNotContain: { kind: 'value', strength: 2 },
  startsWith: { kind: 'value', strength: 2 },
  endsWith: { kind: 'value', strength: 2 },
  matches: { kind: 'value', strength: 2 },
  isGreaterThan: { kind: 'value', strength: 2 },
  isGreaterThanOrEqualTo: { kind: 'value', strength: 2 },
  isLessThan: { kind: 'value', strength: 2 },
  isLessThanOrEqualTo: { kind: 'value', strength: 2 },
  isBetween: { kind: 'value', strength: 2 },
  isPositive: { kind: 'value', strength: 2 },
  isNegative: { kind: 'value', strength: 2 },
  isZero: { kind: 'value', strength: 2 },
  hasSizeGreaterThan: { kind: 'value', strength: 2 },
  hasSizeLessThan: { kind: 'value', strength: 2 },
  anySatisfy: { kind: 'value', strength: 2 },
  hasMessageContaining: { kind: 'exception', strength: 3 },
  hasMessageStartingWith: { kind: 'exception', strength: 3 },
  hasCauseInstanceOf: { kind: 'exception', strength: 3 },
  isThrownBy: { kind: 'exception', strength: 3 },
  hasSize: { kind: 'value', strength: 3 },
  hasOnlyElementsOfType: { kind: 'value', strength: 3 },
  isNotEqualTo: { kind: 'value', strength: 3 },
  isNotSameAs: { kind: 'value', strength: 3 },
  isCloseTo: { kind: 'value', strength: 3 },
  containsOnly: { kind: 'value', strength: 3 },
  containsAll: { kind: 'value', strength: 3 },
  allSatisfy: { kind: 'value', strength: 3 },
  allMatch: { kind: 'value', strength: 3 },
  satisfies: { kind: 'value', strength: 3 },
  isEqualToIgnoringCase: { kind: 'value', strength: 3 },
  isEqualToIgnoringWhitespace: { kind: 'value', strength: 3 },
  hasFieldOrPropertyWithValue: { kind: 'value', strength: 3 },
  isEqualTo: { kind: 'value', strength: 4 },
  isSameAs: { kind: 'value', strength: 4 },
  isEqualByComparingTo: { kind: 'value', strength: 4 },
  containsExactly: { kind: 'value', strength: 4 },
  containsExactlyInAnyOrder: { kind: 'value', strength: 4 },
  containsExactlyElementsOf: { kind: 'value', strength: 4 },
  containsExactlyInAnyOrderElementsOf: { kind: 'value', strength: 4 },
  containsExactlyEntriesOf: { kind: 'value', strength: 4 },
  hasMessage: { kind: 'exception', strength: 4 },
  hasSameElementsAs: { kind: 'value', strength: 4 },
  hasToString: { kind: 'value', strength: 4 },
  isEqualToComparingFieldByField: { kind: 'value', strength: 4 },
  isEqualToComparingFieldByFieldRecursively: { kind: 'value', strength: 4 },
  isEqualToIgnoringGivenFields: { kind: 'value', strength: 3 },
  hasValue: { kind: 'value', strength: 4 },
  containsSequence: { kind: 'value', strength: 3 },
  containsSubsequence: { kind: 'value', strength: 3 },
  isSorted: { kind: 'value', strength: 2 },
  usingRecursiveComparison: { kind: 'value', strength: 2 },
};

/** AssertJ chain starters and whether the subject is the lambda (exception shapes). */
export const assertjStarters: Record<string, { kind?: AssertionKind; strength?: number }> = {
  assertThat: {},
  assertThatObject: {},
  assertThatCode: {},
  assertThatThrownBy: { kind: 'exception', strength: 3 },
  assertThatExceptionOfType: { kind: 'exception', strength: 3 },
  assertThatIllegalArgumentException: { kind: 'exception', strength: 3 },
  assertThatIllegalStateException: { kind: 'exception', strength: 3 },
  assertThatNullPointerException: { kind: 'exception', strength: 3 },
  assertThatIOException: { kind: 'exception', strength: 3 },
  assertThatNoException: { kind: 'smoke', strength: 1 },
  assertThatRuntimeException: { kind: 'exception', strength: 3 },
};

/** AssertJ methods on a chain that only describe or navigate, never assert. */
export const assertjDescribers = new Set([
  'as', 'describedAs', 'withFailMessage', 'overridingErrorMessage', 'usingComparator',
  'usingRecursiveComparison', 'usingDefaultComparator', 'extracting', 'map', 'flatMap',
  'filteredOn', 'first', 'last', 'element', 'get', 'asList', 'asString', 'asInstanceOf',
  'ignoringFields', 'ignoringExpectedNullFields', 'withPrecision', 'within', 'and',
  'returns', 'extractingResultOf', 'satisfiesAnyOf', 'inOrder',
]);

/** Google Truth. `assertWithMessage("..").that(x).isEqualTo(y)` is also supported. */
export const truthTerminals: Record<string, AssertionShape> = {
  isNotNull: { kind: 'smoke', strength: 1 },
  isInstanceOf: { kind: 'smoke', strength: 1 },
  isPresent: { kind: 'smoke', strength: 1 },
  isNotEmpty: { kind: 'smoke', strength: 1 },
  isTrue: { kind: 'value', strength: 2 },
  isFalse: { kind: 'value', strength: 2 },
  isNull: { kind: 'value', strength: 2 },
  isEmpty: { kind: 'value', strength: 2 },
  contains: { kind: 'value', strength: 2 },
  containsKey: { kind: 'value', strength: 2 },
  doesNotContain: { kind: 'value', strength: 2 },
  startsWith: { kind: 'value', strength: 2 },
  isGreaterThan: { kind: 'value', strength: 2 },
  isLessThan: { kind: 'value', strength: 2 },
  isAtLeast: { kind: 'value', strength: 2 },
  isAtMost: { kind: 'value', strength: 2 },
  hasSize: { kind: 'value', strength: 3 },
  isNotEqualTo: { kind: 'value', strength: 3 },
  containsAtLeast: { kind: 'value', strength: 3 },
  isEqualTo: { kind: 'value', strength: 4 },
  isSameInstanceAs: { kind: 'value', strength: 4 },
  containsExactly: { kind: 'value', strength: 4 },
  containsExactlyElementsIn: { kind: 'value', strength: 4 },
  hasMessageThat: { kind: 'exception', strength: 3 },
  hasCauseThat: { kind: 'exception', strength: 3 },
};

/** Hamcrest matchers, keyed by the outermost matcher in `assertThat(actual, matcher)`. */
export const hamcrestMatchers: Record<string, AssertionShape> = {
  notNullValue: { kind: 'smoke', strength: 1 },
  instanceOf: { kind: 'smoke', strength: 1 },
  isA: { kind: 'smoke', strength: 1 },
  anything: { kind: 'smoke', strength: 1 },
  nullValue: { kind: 'value', strength: 2 },
  not: { kind: 'value', strength: 2 },
  hasItem: { kind: 'value', strength: 2 },
  hasItems: { kind: 'value', strength: 2 },
  hasKey: { kind: 'value', strength: 2 },
  hasEntry: { kind: 'value', strength: 2 },
  containsString: { kind: 'value', strength: 2 },
  startsWith: { kind: 'value', strength: 2 },
  endsWith: { kind: 'value', strength: 2 },
  greaterThan: { kind: 'value', strength: 2 },
  greaterThanOrEqualTo: { kind: 'value', strength: 2 },
  lessThan: { kind: 'value', strength: 2 },
  lessThanOrEqualTo: { kind: 'value', strength: 2 },
  empty: { kind: 'value', strength: 2 },
  emptyString: { kind: 'value', strength: 2 },
  anyOf: { kind: 'value', strength: 2 },
  hasSize: { kind: 'value', strength: 3 },
  hasProperty: { kind: 'value', strength: 3 },
  closeTo: { kind: 'value', strength: 3 },
  allOf: { kind: 'value', strength: 3 },
  both: { kind: 'value', strength: 3 },
  equalToIgnoringCase: { kind: 'value', strength: 3 },
  is: { kind: 'value', strength: 4 },
  equalTo: { kind: 'value', strength: 4 },
  sameInstance: { kind: 'value', strength: 4 },
  theInstance: { kind: 'value', strength: 4 },
  contains: { kind: 'value', strength: 4 },
  containsInAnyOrder: { kind: 'value', strength: 4 },
  arrayContaining: { kind: 'value', strength: 4 },
  samePropertyValuesAs: { kind: 'value', strength: 4 },
};

/** Mockito verification. Strength from the verification mode. */
export const mockitoVerifications: Record<string, AssertionShape> = {
  verify: { kind: 'interaction', strength: 3 },
  verifyNoMoreInteractions: { kind: 'interaction', strength: 3 },
  verifyNoInteractions: { kind: 'interaction', strength: 3 },
  verifyZeroInteractions: { kind: 'interaction', strength: 3 },
  should: { kind: 'interaction', strength: 3 },
  shouldHaveNoInteractions: { kind: 'interaction', strength: 3 },
  shouldHaveNoMoreInteractions: { kind: 'interaction', strength: 3 },
};

/** `verify(mock, mode)`: how the mode changes the strength. */
export const mockitoModes: Record<string, number> = {
  times: 4,
  never: 3,
  only: 4,
  atLeastOnce: 2,
  atLeast: 2,
  atMost: 2,
  atMostOnce: 2,
  timeout: 2,
  after: 2,
  calls: 4,
  description: 3,
};

/** Spring MockMvc `andExpect(matcher)`: strength from the matcher chain. */
export const springMatchers: Record<string, AssertionShape> = {
  'status.is2xxSuccessful': { kind: 'smoke', strength: 1 },
  'status.is4xxClientError': { kind: 'value', strength: 2 },
  'status.is5xxServerError': { kind: 'value', strength: 2 },
  'status.isOk': { kind: 'value', strength: 2 },
  'status.is': { kind: 'value', strength: 3 },
  'jsonPath.exists': { kind: 'smoke', strength: 1 },
  'jsonPath.isNotEmpty': { kind: 'smoke', strength: 1 },
  'jsonPath.doesNotExist': { kind: 'value', strength: 2 },
  'jsonPath.isArray': { kind: 'value', strength: 2 },
  'jsonPath.value': { kind: 'value', strength: 4 },
  'content.string': { kind: 'value', strength: 4 },
  'content.json': { kind: 'value', strength: 4 },
  'content.xml': { kind: 'value', strength: 4 },
  'content.contentType': { kind: 'value', strength: 3 },
  'content.contentTypeCompatibleWith': { kind: 'value', strength: 2 },
  'header.string': { kind: 'value', strength: 3 },
  'header.exists': { kind: 'smoke', strength: 1 },
  'header.doesNotExist': { kind: 'value', strength: 2 },
  'view.name': { kind: 'value', strength: 3 },
  'model.attribute': { kind: 'value', strength: 3 },
  'model.attributeExists': { kind: 'smoke', strength: 1 },
  'redirectedUrl': { kind: 'value', strength: 3 },
  'forwardedUrl': { kind: 'value', strength: 3 },
  'cookie.value': { kind: 'value', strength: 3 },
};

/** REST Assured `then()` terminals. */
export const restAssuredTerminals: Record<string, AssertionShape> = {
  statusCode: { kind: 'value', strength: 2 },
  statusLine: { kind: 'value', strength: 2 },
  contentType: { kind: 'value', strength: 2 },
  header: { kind: 'value', strength: 2 },
  headers: { kind: 'value', strength: 2 },
  cookie: { kind: 'value', strength: 2 },
  time: { kind: 'value', strength: 1 },
  body: { kind: 'value', strength: 3 },
  content: { kind: 'value', strength: 3 },
  spec: { kind: 'value', strength: 2 },
  assertThat: { kind: 'smoke', strength: 1 },
};

/** Awaitility terminals on `await()...`. */
export const awaitilityTerminals: Record<string, AssertionShape> = {
  untilAsserted: { kind: 'value', strength: 3 },
  until: { kind: 'value', strength: 2 },
  untilTrue: { kind: 'value', strength: 2 },
  untilFalse: { kind: 'value', strength: 2 },
  untilAtomic: { kind: 'value', strength: 2 },
  untilCall: { kind: 'value', strength: 2 },
};

/**
 * Collection and size style checks. When the subject is a plain variable or
 * field (not a call result) the assertion is reported as `state`, best effort.
 */
export const stateMatchers = new Set([
  'hasSize', 'isEmpty', 'isNotEmpty', 'contains', 'containsExactly', 'containsExactlyInAnyOrder',
  'containsOnly', 'containsAll', 'doesNotContain', 'containsKey', 'containsEntry', 'hasItem',
  'hasItems', 'hasKey', 'hasEntry', 'containsInAnyOrder', 'empty', 'hasValue', 'hasFieldOrPropertyWithValue',
]);

/** Snapshot and approval style terminals. */
export const snapshotTerminals = new Set(['toMatchSnapshot', 'toMatchSnapshotWith', 'verifyAsJson', 'verifyAll']);

/** Import prefixes that identify an assertion family (checked longest first). */
export const assertionFamilyImports: Array<[prefix: string, family: string]> = [
  ['org.assertj.', 'assertj'],
  ['com.google.common.truth.', 'truth'],
  ['org.hamcrest.', 'hamcrest'],
  ['org.mockito.', 'mockito'],
  ['org.springframework.test.web.', 'spring'],
  ['io.restassured.', 'restassured'],
  ['org.awaitility.', 'awaitility'],
  ['org.approvaltests.', 'approvals'],
  ['au.com.origin.snapshots.', 'snapshot'],
];

/* ------------------------------------------------------------------------ */
/* M001 mock shapes                                                          */
/* ------------------------------------------------------------------------ */

export interface MockAnnotationRule {
  name: string;
  partial: boolean;
}

export const mockAnnotations: MockAnnotationRule[] = [
  { name: 'Mock', partial: false },
  { name: 'MockBean', partial: false },
  { name: 'MockitoBean', partial: false },
  { name: 'Spy', partial: true },
  { name: 'SpyBean', partial: true },
  { name: 'MockitoSpyBean', partial: true },
];

/** `mock(X.class)`, `Mockito.mock(X.class)`, `mockStatic(X.class)`, `spy(x)`. */
export const mockCalls: Record<string, { partial: boolean; staticMock: boolean }> = {
  mock: { partial: false, staticMock: false },
  mockStatic: { partial: false, staticMock: true },
  mockConstruction: { partial: false, staticMock: true },
  spy: { partial: true, staticMock: false },
};

/* ------------------------------------------------------------------------ */
/* T001 to T003 timing shapes                                                */
/* ------------------------------------------------------------------------ */

/** Sleep calls as `qualifier.name` patterns; `*` matches any qualifier. */
export const sleepCalls: Array<{ qualifier: string; name: string; unit: 'ms' | 'enum' }> = [
  { qualifier: 'Thread', name: 'sleep', unit: 'ms' },
  { qualifier: 'TimeUnit.*', name: 'sleep', unit: 'enum' },
  { qualifier: 'SECONDS', name: 'sleep', unit: 'enum' },
  { qualifier: 'MILLISECONDS', name: 'sleep', unit: 'enum' },
  { qualifier: 'MINUTES', name: 'sleep', unit: 'enum' },
];

/** Awaitility entry points. They poll rather than sleep but are timing signals. */
export const awaitCalls = new Set(['await', 'with', 'given']);

/** TimeUnit enum constant to milliseconds. */
export const timeUnitMs: Record<string, number> = {
  NANOSECONDS: 1e-6,
  MICROSECONDS: 1e-3,
  MILLISECONDS: 1,
  SECONDS: 1000,
  MINUTES: 60_000,
  HOURS: 3_600_000,
  DAYS: 86_400_000,
};
