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

export type Need = 'diff' | 'ast' | 'junit' | 'config' | 'workflow' | 'prtext';

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
  framework: string;
}

export interface TestInventory {
  path: string;
  language: LanguageId;
  framework: string;
  tests: TestCase[];
  /** Helper functions in the file whose body contains assertions, by name. */
  assertionHelpers: Set<string>;
  imports: string[];
  /** Module level skip markers (for example `pytestmark = pytest.mark.skip`). */
  fileMarkers: SkipMarker[];
  parseErrors: number;
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
  paths: { tests: string[]; ignore: string[] };
  junit: { head: string; base: string };
  assertions: { extra: string[] };
  rules: Record<string, RuleConfigEntry>;
  acknowledge: Array<{ fingerprint: string; reason: string; by: string; date: string }>;
  provenance: { show: boolean; stricterForAgents: boolean };
  claims: { enabled: boolean; phrasesExtra: string[] };
  comment: { enabled: boolean; collapseLow: boolean };
}

export interface Report {
  $schema: string;
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
  timing: { totalMs: number; parseMs: number; rulesMs: number; evidenceMs: number };
  base: string;
  head: string;
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
