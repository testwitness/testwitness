/**
 * Helpers for unit testing rules without tree-sitter: build inventories by hand.
 * Exported from the package so fixture and plugin authors can reuse them.
 */
import type { Assertion, CallSite, ChangedFile, Evidence, InventoryPair, LanguageId, MutationEvidence, RuleContext, SkipMarker, TestCase, TestInventory } from '../types.js';
import { defaultConfig } from '../config.js';
import { fingerprint } from '../hash.js';
import { shortHash } from '../hash.js';

export interface TestSpec {
  name: string;
  container?: string[];
  body?: string;
  statements?: number;
  assertions?: Array<Partial<Assertion> & { callee: string }>;
  markers?: Array<Partial<SkipMarker> & { marker: string; kind: SkipMarker['kind'] }>;
  parameterCount?: number;
  mocks?: string[];
  line?: number;
  /** Call sites; `statement` defaults to true and `name` to the last segment of the callee. */
  calls?: Array<Partial<CallSite> & { callee: string; line: number }>;
}

export function test(spec: TestSpec): TestCase {
  const container = spec.container ?? [];
  const body = spec.body ?? `body of ${spec.name}`;
  const line = spec.line ?? 1;
  const t: TestCase = {
    name: spec.name,
    qualifiedName: container.length ? `${container.join(' › ')} › ${spec.name}` : spec.name,
    container,
    startLine: line,
    endLine: line + 3,
    bodyHash: shortHash(body),
    statementCount: spec.statements ?? (body.trim() ? 1 : 0),
    assertions: (spec.assertions ?? []).map((a, i) => ({ text: a.text ?? `${a.callee}(${a.subject ?? 'x'})`, line: line + 1 + i, kind: a.kind ?? 'value', ...a })),
    markers: (spec.markers ?? []).map((m) => ({ line: line, ...m })),
    mocks: spec.mocks ?? [],
    framework: 'synthetic',
  };
  if (spec.parameterCount !== undefined) t.parameterCount = spec.parameterCount;
  if (spec.calls) t.calls = spec.calls.map((c) => ({ name: c.callee.split('.').pop() ?? c.callee, statement: true, ...c }));
  return t;
}

export function inventory(path: string, tests: TestCase[], extra: Partial<TestInventory> = {}): TestInventory {
  return {
    path,
    language: extra.language ?? 'typescript',
    framework: 'synthetic',
    tests,
    assertionHelpers: new Set(),
    imports: [],
    fileMarkers: [],
    parseErrors: 0,
    ...extra,
  };
}

export function changedFile(path: string, status: ChangedFile['status'] = 'modified', language: LanguageId = 'typescript'): ChangedFile {
  return { status, path, kind: 'test', language, hunks: [], binary: false, addedLines: new Set(), removedLines: new Set() };
}

export interface ContextSpec {
  pairs: InventoryPair[];
  headTree?: Record<string, TestInventory>;
  changedProduction?: string[];
  prText?: { title: string; body: string };
  evidence?: Evidence;
  /** Changed files beyond the test files of `pairs` (production files for the coverage and mutation rules). */
  files?: ChangedFile[];
  mutation?: MutationEvidence;
}

export function context(spec: ContextSpec): RuleContext {
  const headTree = spec.headTree ?? {};
  for (const p of spec.pairs) if (p.head) headTree[p.file.path] = p.head;
  const cfg = defaultConfig();
  return {
    files: [...spec.pairs.map((p) => p.file), ...(spec.files ?? [])],
    pairs: spec.pairs,
    headInventoryFor: async (path) => headTree[path],
    headTestFiles: async () => Object.keys(headTree),
    readBase: async () => undefined,
    readHead: async () => undefined,
    ...(spec.prText ? { prText: spec.prText } : {}),
    ...(spec.evidence ? { evidence: spec.evidence } : {}),
    ...(spec.mutation ? { mutation: spec.mutation } : {}),
    profile: { frameworks: new Set(), extraAssertions: [] },
    config: cfg,
    fingerprint,
    changedProductionFiles: new Set(spec.changedProduction ?? []),
  };
}
