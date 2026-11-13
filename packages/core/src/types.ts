/**
 * Core types for testwitness. Everything in the engine speaks these shapes.
 * See docs/design.md for why they look the way they do.
 */

export type Severity = 'high' | 'medium' | 'low';
export type SeveritySetting = Severity | 'off';
export type CheckState = 'pass' | 'review' | 'unreadable';
export type Mode = 'report' | 'require-ack' | 'strict';

export type LanguageId = 'java' | 'typescript' | 'javascript' | 'python';

export type RuleGroup = 'R' | 'A' | 'O' | 'E' | 'S' | 'M' | 'T' | 'C' | 'W' | 'X' | 'V' | 'Q';

export type Need = 'diff' | 'ast' | 'junit' | 'config' | 'workflow' | 'prtext' | 'coverage' | 'mutation';

/** File status in the diff. */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type FileKind =
  | 'test'
  | 'production'
  | 'runner-config'
  | 'ci-workflow'
  | 'snapshot'
  | 'coverage-config'
  | 'lockfile'
  | 'other';

export interface Hunk {
  /** 1-based start line in the base file, 0 when the hunk is pure insertion at file start. */
  baseStart: number;
  baseCount: number;
  /** 1-based start line in the head file. */
  headStart: number;
  headCount: number;
  /** Lines removed from base, without the leading '-'. */
  removed: string[];
  /** Lines added in head, without the leading '+'. */
  added: string[];
}

export interface ChangedFile {
  status: FileStatus;
  /** Path in head (or base for deleted files). */
  path: string;
  /** Path in base when renamed. */
  oldPath?: string;
  kind: FileKind;
  language?: LanguageId;
  hunks: Hunk[];
  binary: boolean;
  /** Set of head line numbers that were added or changed. */
  addedLines: Set<number>;
  /** Set of base line numbers that were removed or changed. */
  removedLines: Set<number>;
}

export type AssertionKind = 'value' | 'state' | 'interaction' | 'exception' | 'snapshot' | 'smoke' | 'custom';

export interface Assertion {
  /** Normalised call text, for example `expect(x).toBe` or `assertEquals`. */
  callee: string;
  /** Normalised subject expression text if identifiable. */
  subject?: string;
  /** Normalised expected operand text if identifiable (matcher argument, expected side of assertEquals, right side of pytest ==). */
  expected?: string;
  /** Raw source text of the full statement, trimmed. */
  text: string;
  line: number;
  kind: AssertionKind;
  /** Position in the strength lattice for A002, when the family is known. */
  family?: string;
  strength?: number;
  /**
   * Matcher or operator as the front end read it when the callee does not carry it: the comparison operator of a bare
   * Python assert (`==`, `in`, `is not`, `>=`), `truthy` or `not` for a bare truthiness check. Core reads the
   * terminal name of the callee otherwise. See assertion-meaning.ts.
   */
  matcher?: string;
  /**
   * Set when the assertion is a call to a project helper defined in another file of the checkout, found through the
   * helper index (see docs/design.md, Helpers in other files). The call counts as a custom assertion.
   */
  resolvedVia?: 'helper-index';
  /** The helper definition the call resolved to, when `resolvedVia` is set. */
  helper?: { name: string; path: string; line: number; className?: string };
}

export interface SkipMarker {
  /** Normalised marker name, for example `@Disabled`, `it.skip`, `pytest.mark.skip`. */
  marker: string;
  /** Marker category. */
  kind: 'skip' | 'focus' | 'todo' | 'fixme' | 'xfail' | 'conditional-skip';
  /** Reason string if present. */
  reason?: string;
  /** True when the condition could be folded to a constant truth. */
  constant?: boolean;
  line: number;
}

export interface CatchAll {
  line: number;
  /** Caught type as written: Exception, Throwable, bare except, any (JavaScript). */
  binding: string;
  /** True when the catch body neither rethrows, fails, nor asserts. */
  swallows: boolean;
  /** Normalised text of the try block's first statement, for the fingerprint. */
  snippet: string;
  /**
   * A promise deliberately left running in the background (`void call().catch(() => {})`) with assertions after it in
   * the test: the handler keeps an expected rejection from going unhandled, it does not hide the oracle. Optional.
   */
  background?: boolean;
}

export interface TestCase {
  /** Short name: method name, `it` title, function name. */
  name: string;
  /** Qualified name used as the stable key: Class#method, describe › it, module::Class::test. */
  qualifiedName: string;
  /** Enclosing container path (class, describe blocks). */
  container: string[];
  startLine: number;
  endLine: number;
  /** Hash of the normalised body, for move and rename detection. */
  bodyHash: string;
  /** Number of executable statements in the body. */
  statementCount: number;
  assertions: Assertion[];
  markers: SkipMarker[];
  /** Number of parameterised cases when countable; `undefined` means unknown or not parameterised. */
  parameterCount?: number;
  /** True when the test is parameterised at all, including dynamic sources (@MethodSource, a variable passed to parametrize). */
  parameterised?: boolean;
  /** Catch blocks in the test body that swallow exceptions (E001). */
  catchAlls?: CatchAll[];
  /** True when the body only delegates to the inherited test (super().test_x(), super.testX()). */
  overrideOnly?: boolean;
  /** Mock or stub targets declared in the body. */
  mocks: string[];
  /**
   * Every call in the body, in source order, including assertions and calls nested in arguments or callbacks. Used by
   * A001 to tell an assertion replaced by a helper call it cannot resolve from a plain removal. Optional: a front end
   * that does not fill it makes A001 behave as if no call was added.
   */
  calls?: CallSite[];
  /**
   * Local names bound once in the test body, mapped to the initialiser text (`names = [f.name for f in features]`).
   * A002 resolves an assertion subject through a binding when the initialiser is a projection of another plain
   * reference, so `assert x in names` pairs with `assert len(features) == 3`. Optional.
   */
  locals?: Record<string, string>;
  /**
   * Matcher checks nested inside a project helper or matcher the front end cannot read as an assertion of its own:
   * a Hamcrest matcher passed to `event.hasValueMatching(...)`, an expectation object passed to a project
   * `requireRequestsFrom(client).toMatch({...})`. A002 compares them like assertions; A001 and O001 never count them.
   */
  embedded?: Assertion[];
  framework: string;
}

export interface CallSite {
  /** Callee as written, whitespace removed: `result.did_create`, `console.log`, `assertThat(x).isEqualTo`. */
  callee: string;
  /** Last name segment of the callee: `did_create`, `log`, `isEqualTo`. */
  name: string;
  line: number;
  /** True when the call is the whole expression of an expression statement, possibly awaited. */
  statement: boolean;
  /** Source text of the call, trimmed. Optional; the helper index uses it as the assertion text of a resolved call. */
  text?: string;
}

/**
 * A function or method defined outside any test, as the helper index sees it: where it is, which class it belongs to,
 * the assertions written directly in its body and the names of the calls it makes as statements.
 */
export interface HelperDefinition {
  name: string;
  /** Enclosing class, when the definition is a method. */
  className?: string;
  line: number;
  /** Assertions directly in the body: framework assertions, name based assertions and calls to assertions.extra. */
  assertions: Assertion[];
  /** Names of the calls the body makes as whole statements, in source order, for resolution one level further. */
  calls: string[];
}

export interface TestInventory {
  path: string;
  language: LanguageId;
  framework: string;
  tests: TestCase[];
  /** Helper functions in the file whose body contains assertions, by name. */
  assertionHelpers: Set<string>;
  /** The assertions inside each assertion helper, by helper name, in source order. Optional; A002 compares them across base and head. */
  helperAssertions?: Record<string, Assertion[]>;
  imports: string[];
  /** Module level skip markers (for example `pytestmark = pytest.mark.skip`). */
  fileMarkers: SkipMarker[];
  parseErrors: number;
  /** Functions and methods defined outside tests, for the helper index. Optional. */
  definitions?: HelperDefinition[];
  /** Direct superclasses of each class declared in the file, by class name (simple names, generics dropped). Optional. */
  classBases?: Record<string, string[]>;
}

export interface FrameworkProfile {
  /** Frameworks detected from the repository's dependency manifests. */
  frameworks: Set<string>;
  /** Extra assertion helper names from config. */
  extraAssertions: string[];
}

export interface Location {
  path: string;
  line?: number;
  endLine?: number;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  location: Location;
  /** Stable fingerprint: survives line shifts and rebases. */
  fingerprint: string;
  /** Qualified test name or config key the finding is about. */
  subject?: string;
  before?: string;
  after?: string;
  /** Extra label such as `moved`, `smoke`, `helper extraction`. */
  label?: string;
  acknowledged?: Acknowledgement;
}

export interface Acknowledgement {
  by: string;
  reason: string;
  at: string;
  via: 'config' | 'comment' | 'label';
}

export interface Rule<Options = Record<string, unknown>> {
  id: string;
  name: string;
  group: RuleGroup;
  defaultSeverity: Severity;
  since: string;
  languages: LanguageId[] | 'any';
  needs: Need[];
  optionsSchema?: Record<string, unknown>;
  defaultOptions?: Options;
  run(ctx: RuleContext, options: Options): Finding[] | Promise<Finding[]>;
  docs: {
    summary: string;
    falsePositives: string;
    example: string;
    /** How run history changes the severity, when it does (docs/history.md). */
    history?: string;
  };
}

/** A pair of inventories for one changed test file. */
export interface InventoryPair {
  file: ChangedFile;
  base?: TestInventory;
  head?: TestInventory;
}

export interface Evidence {
  /** Files that were read. */
  sources: string[];
  /** Formats of the files that were read (junit-xml, tap, jest-json, vitest-json, pytest-json-report, playwright-json). Optional; absent means JUnit XML. */
  formats?: string[];
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  flaky: number;
  /** Lookup by normalised key. */
  has(key: string): boolean;
  statusOf(key: string): TestStatus | undefined;
  /** All keys that share a file or class prefix. */
  keysForClass(classKey: string): string[];
  /** Every key, for template matching (test.each titles). */
  keys(): Iterable<string>;
  /** Rerun and flaky child elements recorded for a key, for the run history. Optional; 0 when absent. */
  rerunsOf?(key: string): number;
}

/** Line coverage of one source file: lines the tool instrumented and the subset some test executed. */
export interface FileCoverage {
  instrumented: ReadonlySet<number>;
  executed: ReadonlySet<number>;
}

/**
 * Line coverage read from lcov, Cobertura or JaCoCo reports of the head run. Paths are matched against repository
 * relative paths: exactly when the report path could be made relative to the root, otherwise by path suffix.
 */
export interface CoverageEvidence {
  /** Report files that were read. */
  sources: string[];
  /** Source files with coverage data. */
  files: number;
  linesInstrumented: number;
  linesExecuted: number;
  /** Reader warnings and caps that were hit. */
  warnings: string[];
  /** Coverage of a repository relative path, if the reports cover it. */
  lookup(path: string): FileCoverage | undefined;
}

/** The coverage section of the report. Present only when coverage reports were attached. */
export interface CoverageSummary {
  sources: string[];
  files: number;
  linesInstrumented: number;
  linesExecuted: number;
  notes: string[];
}

/** Mutants that start on one source line, by outcome. Timeout counts as killed: the tests noticed the change. */
export interface LineMutation {
  /** Mutants that ran to an outcome (killed, timed out, survived or not covered). Compile errors, runtime errors, ignored and pending mutants are not counted. */
  total: number;
  /** Killed or timed out. */
  killed: number;
  survived: number;
  noCoverage: number;
  /** Normalised test keys (`classKey::nameKey`, as the JUnit reader builds them) of the tests that killed a mutant on the line. Empty when the report names no tests. */
  killedBy: ReadonlySet<string>;
  /** Normalised keys of the tests that executed a mutant on the line, when the report records it (Stryker coveredBy). */
  coveredBy: ReadonlySet<string>;
}

/** Mutation results of one production file, by 1-based line. */
export interface FileMutation {
  lines: ReadonlyMap<number, LineMutation>;
}

/**
 * Mutation testing results read from Stryker JSON or PIT mutations.xml reports. The engine never runs a mutation tool;
 * it reads what an opt in job produced (docs/mutation-on-request.md). Paths are matched like coverage paths.
 */
export interface MutationEvidence {
  /** Report files that were read. */
  sources: string[];
  /** Tools whose reports were read: stryker, pit. */
  tools: string[];
  /** Production files with mutants. */
  files: number;
  mutants: number;
  killed: number;
  survived: number;
  noCoverage: number;
  /** True when the reports name the tests that killed mutants (Stryker killedBy with testFiles, PIT killingTest). M002 needs it. */
  testIds: boolean;
  /** Keys of every test the mutation run knew about, when the report lists them (Stryker testFiles). */
  tests?: ReadonlySet<string>;
  /** Keys of every test that killed at least one mutant anywhere in the reports. */
  killers: ReadonlySet<string>;
  /** Reader warnings, caps that were hit, and why a rule could not use the data. */
  warnings: string[];
  /** Mutation results of a repository relative path, if the reports cover it. */
  lookup(path: string): FileMutation | undefined;
}

/** The mutation section of the report. Present only when mutation reports were attached. */
export interface MutationSummary {
  sources: string[];
  files: number;
  mutants: number;
  killed: number;
  survived: number;
  noCoverage: number;
  notes: string[];
}

export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'flaky';

export interface PullRequestText {
  title: string;
  body: string;
  lastCommitMessage?: string;
}

export interface RuleContext {
  files: ChangedFile[];
  pairs: InventoryPair[];
  /** Inventories of every test file in head, built lazily, for move detection. */
  headInventoryFor(path: string): Promise<TestInventory | undefined>;
  /** All test files in the head tree (paths). */
  headTestFiles(): Promise<string[]>;
  readBase(path: string): Promise<string | undefined>;
  readHead(path: string): Promise<string | undefined>;
  evidence?: Evidence;
  /** Line coverage of the head run, when reports were attached. */
  coverage?: CoverageEvidence;
  /** Mutation testing results of the head, when an opt in mutation job attached its reports. */
  mutation?: MutationEvidence;
  prText?: PullRequestText;
  profile: FrameworkProfile;
  config: ResolvedConfig;
  /** Build a fingerprint for a finding. */
  fingerprint(ruleId: string, path: string, subject: string, snippet?: string): string;
  /** Production files changed in this PR, by path. */
  changedProductionFiles: Set<string>;
}

export interface RuleConfigEntry {
  severity: SeveritySetting;
  options: Record<string, unknown>;
}

export interface ResolvedConfig {
  version: 1;
  mode: Mode;
  failOn: Severity;
  requireEvidence: boolean;
  languages: LanguageId[] | 'auto';
  /**
   * `followSymlinks`: whether the results, coverage, mutation and history globs follow symbolic links. Off by
   * default, so a link committed by a pull request cannot make the check read a file outside the repository; turn it
   * on for layouts that link their outputs into the checkout (Bazel's bazel-testlogs).
   */
  paths: { tests: string[]; ignore: string[]; followSymlinks: boolean };
  /** Globs of the test results of the head run (config key `results`, or its older name `junit`). Any supported format; told apart by content. */
  junit: { head: string; base: string };
  /** Globs of lcov, Cobertura or JaCoCo coverage reports of the head run. Empty: no coverage is read. */
  coverage: { paths: string[] };
  /** Globs of Stryker JSON or PIT mutations.xml reports from the opt in mutation job. Empty: no mutation data is read. */
  mutation: { paths: string[] };
  assertions: { extra: string[] };
  rules: Record<string, RuleConfigEntry>;
  acknowledge: Array<{ fingerprint: string; reason: string; by: string; date: string }>;
  provenance: { show: boolean; stricterForAgents: boolean };
  claims: { enabled: boolean; phrasesExtra: string[] };
  comment: { enabled: boolean; collapseLow: boolean };
}

export interface Report {
  $schema: string;
  /** Version of the report shape; bumped only on a breaking change. See docs/report.schema.json. */
  schemaVersion: '1';
  tool: { name: 'testwitness'; version: string };
  generatedAt: string;
  state: CheckState;
  mode: Mode;
  summary: {
    testsDeleted: number;
    testsSkipped: number;
    assertionsWeakened: number;
    changedTestsNotRun: number;
    findings: { high: number; medium: number; low: number };
  };
  findings: Finding[];
  evidence: {
    state: 'read' | 'unreadable' | 'partial';
    sources: string[];
    /** Formats of the result files that were read, sorted. Empty when none were read. */
    formats?: string[];
    total: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
    flaky: number;
    notes: string[];
  };
  provenance: ProvenanceInfo;
  files: { changed: number; tests: number; production: number; config: number; workflows: number; snapshots: number };
  timing: { totalMs: number; parseMs: number; rulesMs: number; evidenceMs: number; helperIndexMs?: number };
  /** The helper index, when a changed test called a function the file could not resolve. Absent when it was not needed. */
  helperIndex?: HelperIndexSummary;
  /** Coverage reports read for V008. Absent when none were attached. */
  coverage?: CoverageSummary;
  /** Mutation reports read for M001, M002 and the O001 and O002 adjustment. Absent when none were attached. */
  mutation?: MutationSummary;
  /** Run history used for dynamic severity. Absent when no history input was given. */
  history?: HistorySummary;
  base: string;
  head: string;
}

/** The history section of the report. */
export interface HistorySummary {
  /** Where the history came from: a file path, or the artifact name and run id in the Action. */
  source: string;
  /** Earlier runs in the history that was read (0 when it could not be read or was empty). */
  runs: number;
  /** Test keys tracked in the history that was read. */
  tests: number;
  /** Findings whose severity or label the history changed. */
  adjusted: number;
  /** Why the history could not be read, and caps that were hit. */
  notes: string[];
}

export interface HelperIndexSummary {
  /** Support files considered (after the location filter and the caps). */
  files: number;
  /** Files parsed in this run (the rest were served from the cache or did not mention a called name). */
  parsed: number;
  /** Files whose definitions came from the cache, or from a changed test file the run had already parsed. */
  cached: number;
  /** Helpers with at least one assertion that a changed test called. */
  helpers: number;
  /** True when the file or byte cap stopped the scan. */
  capped: boolean;
  warnings: string[];
  /** Calls counted as assertions through the index. */
  resolved: Array<{ path: string; test: string; line: number; helper: string; definedIn: string; definedLine: number }>;
}

export interface ProvenanceInfo {
  agents: Array<{ name: string; signals: string[] }>;
  botAuthor?: string;
}

export interface LanguageFrontEnd {
  id: LanguageId;
  extensions: string[];
  /** Decide whether a path (and optionally its content) is a test file. */
  isTestFile(path: string, source?: string): boolean;
  /** Parse source and build the inventory. */
  inventory(path: string, source: string, profile: FrameworkProfile): Promise<TestInventory>;
  /** Default test path globs for this language. */
  testGlobs: string[];
}
