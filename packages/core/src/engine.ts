import picomatch from 'picomatch';
import type {
  ChangedFile,
  CheckState,
  CoverageEvidence,
  Evidence,
  Finding,
  MutationEvidence,
  FrameworkProfile,
  InventoryPair,
  LanguageFrontEnd,
  LanguageId,
  ProvenanceInfo,
  PullRequestText,
  Report,
  ResolvedConfig,
  Rule,
  RuleContext,
  Severity,
  TestInventory,
} from './types.js';
import { commitMessages, listTree, mergeBase, numstat, rawDiff, revParse, snapshotWorktree, type GitOptions, type WorktreeSnapshot } from './git.js';
import { BlobReader } from './git-batch.js';
import { parseUnifiedDiff } from './diff/parse.js';
import { classifyFiles, classifyPath } from './diff/classify.js';
import { applyConfiguredSeverity, effectiveSeverity, SEVERITY_RANK } from './config.js';
import { fingerprint as makeFingerprint } from './hash.js';
import { builtinRules } from './rules/index.js';
import { detectProvenance } from './provenance.js';
import { HelperIndex, namesToIndex, resolveHelperCalls, secondLevelNames } from './helper-index.js';
import { diffInventories } from './inventory.js';
import type { HelperIndexSummary, HistorySummary, TestCase } from './types.js';
import { mergeHistory, type HistoryDocument, type HistoryResult } from './history/history.js';
import { applyHistory } from './rules/history.js';

/** $id of docs/report.schema.json, the JSON Schema of the report. */
export const REPORT_SCHEMA = 'https://testwitness.github.io/testwitness/report.schema.json';
/** Version of the report shape. Additive changes keep it; a removed or retyped field bumps it. */
export const REPORT_SCHEMA_VERSION = '1' as const;
export const TOOL_VERSION = '0.1.0';

export interface EngineOptions {
  cwd: string;
  base: string;
  head: string;
  /**
   * Compare the merge base with the working tree (staged, unstaged and untracked files that are not ignored) instead
   * of with the `head` commit. `head` still names the commit the merge base and the commit messages come from. Nothing
   * is written into the repository (see snapshotWorktree in git.ts).
   */
  worktree?: boolean;
  frontEnds: LanguageFrontEnd[];
  config: ResolvedConfig;
  rules?: Rule[];
  evidence?: Evidence | undefined;
  /** Line coverage of the head run, read from lcov, Cobertura or JaCoCo reports. */
  coverage?: CoverageEvidence | undefined;
  /**
   * Mutation testing results of the head, read from Stryker JSON or PIT mutations.xml reports that an opt in job wrote.
   * The engine only reads them; it never runs a mutation tool (docs/mutation-on-request.md).
   */
  mutation?: MutationEvidence | undefined;
  /** Why evidence is missing or partial, for the report. */
  evidenceNotes?: string[];
  prText?: PullRequestText | undefined;
  /** PR author, for provenance display only. */
  author?: { login: string; type?: string | undefined } | undefined;
  /** Already resolved: skip merge base computation (used by fixtures). */
  resolved?: boolean;
  /**
   * Helper index over the test support files of the working tree at `cwd`. `false` turns it off; `cacheDir: false`
   * keeps it but writes no cache. Default: on, cache under os.tmpdir().
   */
  helperIndex?: false | { cacheDir?: string | false };
  /**
   * Run history of earlier runs (docs/history.md). When `history` is set, R001, R003, R004 and V003 findings can
   * change severity and label by counting what the tests did before. `historySource` names where it came from for the
   * report; `historyNotes` carries why it could not be read. Either one alone still adds the history section.
   */
  history?: HistoryDocument | undefined;
  historySource?: string | undefined;
  historyNotes?: string[] | undefined;
  /** Merge this run's results into the history and return it as `EngineResult.history`. Default false. */
  recordHistory?: boolean;
  /** Id and date of this run in the updated history. Default: `local-<head sha 10>` and today (UTC). */
  historyRun?: { id?: string | undefined; date?: string | undefined } | undefined;
  log?: (msg: string) => void;
}

export interface EngineResult {
  report: Report;
  files: ChangedFile[];
  pairs: InventoryPair[];
  /**
   * The history with this run's JUnit results merged into the window, when `recordHistory` is set and a history was
   * given or results were read; equal to the input history when no results were read (an empty run is never recorded).
   */
  history?: HistoryDocument;
}

/** The current run's results as history records. */
export function historyResults(evidence: Evidence): HistoryResult[] {
  const out: HistoryResult[] = [];
  for (const key of evidence.keys()) {
    const status = evidence.statusOf(key);
    if (status) out.push({ key, status, reruns: evidence.rerunsOf?.(key) ?? 0 });
  }
  return out;
}

export async function runEngine(opts: EngineOptions): Promise<EngineResult> {
  const snapshot = opts.worktree ? await snapshotWorktree({ cwd: opts.cwd }) : undefined;
  // Blob reads go through one git cat-file --batch process; in working tree mode it reads the snapshot's objects.
  const blobs = new BlobReader(snapshot ? snapshot.git : { cwd: opts.cwd });
  try {
    return await runEngineOn(opts, snapshot, blobs);
  } finally {
    blobs.close();
    snapshot?.dispose();
  }
}

async function runEngineOn(opts: EngineOptions, snapshot: WorktreeSnapshot | undefined, blobs: BlobReader): Promise<EngineResult> {
  const t0 = performance.now();
  const git: GitOptions = snapshot ? snapshot.git : { cwd: opts.cwd };
  const log = opts.log ?? (() => {});

  // In working tree mode the head side is the snapshot tree; the head commit still anchors the merge base and the log.
  const headCommit = await revParse(opts.head, git);
  const baseSha = opts.resolved ? await revParse(opts.base, git) : await mergeBase(opts.base, headCommit, git);
  const headSha = snapshot ? snapshot.tree : headCommit;
  log(`base ${baseSha.slice(0, 10)} head ${snapshot ? `working tree ${headSha.slice(0, 10)} on ` : ''}${headCommit.slice(0, 10)}`);

  // Diff
  const diffText = await rawDiff(baseSha, headSha, git);
  const files = parseUnifiedDiff(diffText);
  const stats = await numstat(baseSha, headSha, git);
  for (const f of files) {
    const s = stats.get(f.path);
    if (s && s.added === null) f.binary = true;
  }

  const readCache = new Map<string, Promise<string | undefined>>();
  const read = (ref: string, path: string): Promise<string | undefined> => {
    const k = `${ref}:${path}`;
    let p = readCache.get(k);
    if (!p) {
      p = blobs.read(ref, path);
      readCache.set(k, p);
    }
    return p;
  };

  // Classification needs a content sniff for source files in unusual paths; read head (or base for deletions) lazily.
  const sniff = new Map<string, string | undefined>();
  for (const f of files) {
    if (f.binary) continue;
    const lang = classifyPath(f.path, undefined, { testGlobs: opts.config.paths.tests, ignoreGlobs: opts.config.paths.ignore });
    if (lang.language && lang.kind === 'production') {
      const content = await read(f.status === 'deleted' ? baseSha : headSha, f.path);
      sniff.set(f.path, content);
    }
  }
  classifyFiles(files, (f) => sniff.get(f.path), { testGlobs: opts.config.paths.tests, ignoreGlobs: opts.config.paths.ignore });

  // Language filter
  const wanted: Set<LanguageId> | undefined = opts.config.languages === 'auto' ? undefined : new Set(opts.config.languages);
  const frontEndFor = (lang: LanguageId | undefined): LanguageFrontEnd | undefined => {
    if (!lang) return undefined;
    if (wanted && !wanted.has(lang)) return undefined;
    return opts.frontEnds.find((fe) => fe.id === lang || (fe.id === 'typescript' && lang === 'javascript'));
  };

  const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: opts.config.assertions.extra };

  // Inventories for changed test files
  const tParse0 = performance.now();
  const pairs: InventoryPair[] = [];
  const invCache = new Map<string, Promise<TestInventory | undefined>>();
  const inventory = async (ref: string, path: string, lang: LanguageId | undefined): Promise<TestInventory | undefined> => {
    const fe = frontEndFor(lang);
    if (!fe) return undefined;
    const k = `${ref}:${path}`;
    let p = invCache.get(k);
    if (!p) {
      p = (async () => {
        const src = await read(ref, path);
        if (src === undefined) return undefined;
        try {
          return await fe.inventory(path, src, profile);
        } catch (err) {
          log(`inventory failed for ${path}: ${(err as Error).message}`);
          return undefined;
        }
      })();
      invCache.set(k, p);
    }
    return p;
  };

  for (const f of files) {
    if (f.kind !== 'test' || f.binary) continue;
    const basePath = f.oldPath ?? f.path;
    const base = f.status === 'added' ? undefined : await inventory(baseSha, basePath, f.language);
    const head = f.status === 'deleted' ? undefined : await inventory(headSha, f.path, f.language);
    const pair: InventoryPair = { file: f };
    if (base) pair.base = base;
    if (head) pair.head = head;
    pairs.push(pair);
  }
  const parseMs = performance.now() - tParse0;

  // Helper index: only when a changed test calls something its own file could not resolve.
  const tIndex0 = performance.now();
  let helperIndex: HelperIndexSummary | undefined;
  if (opts.helperIndex !== false) {
    const changed: Array<{ test: TestCase; inv: TestInventory }> = [];
    for (const pair of pairs) {
      for (const ch of diffInventories(pair.base, pair.head)) {
        if (ch.kind === 'added' || ch.kind === 'modified' || ch.kind === 'renamed') changed.push({ test: ch.head, inv: pair.head! });
        if (ch.kind === 'modified' || ch.kind === 'renamed') changed.push({ test: ch.base, inv: pair.base! });
      }
    }
    const names = namesToIndex(changed);
    const headPairs = new Map(pairs.filter((p) => p.head).map((p) => [p.file.path, p]));
    if (names.size > 0) {
      const extensions = [...new Set(opts.frontEnds.filter((fe) => frontEndFor(fe.id)).flatMap((fe) => fe.extensions))];
      const index = new HelperIndex({
        cwd: opts.cwd,
        frontEndFor: (p) => frontEndFor(classifyPath(p, undefined).language),
        extensions,
        ignore: opts.config.paths.ignore,
        profile,
        version: TOOL_VERSION,
        ...(opts.helperIndex?.cacheDir !== undefined ? { cacheDir: opts.helperIndex.cacheDir } : {}),
        known: async (p, src) => {
          const pair = headPairs.get(p);
          if (!pair?.head) return undefined;
          return (await read(headSha, p)) === src ? pair.head : undefined;
        },
        log,
      });
      await index.ensure(names);
      await index.ensure(secondLevelNames(index, names));
      const resolved = resolveHelperCalls(changed, index);
      index.save();
      const helpers = new Set(resolved.map((r) => `${r.definedIn}:${r.helper}`));
      helperIndex = { files: index.fileCount, parsed: index.parsedCount, cached: index.cachedCount + index.reusedCount, helpers: helpers.size, capped: index.capped, warnings: index.warnings, resolved };
      log(`helper index: ${index.fileCount} support files, ${index.parsedCount} parsed, ${index.cachedCount} cached, ${resolved.length} calls resolved`);
    }
  }
  const helperIndexMs = performance.now() - tIndex0;

  // Head test files, lazily listed, for move detection.
  let headTestFilesP: Promise<string[]> | undefined;
  const ignore = picomatch(opts.config.paths.ignore, { dot: true });
  const headTestFiles = (): Promise<string[]> => {
    headTestFilesP ??= (async () => {
      const all = await listTree(headSha, git);
      return all.filter((p) => !ignore(p) && classifyPath(p, undefined, { testGlobs: opts.config.paths.tests }).kind === 'test');
    })();
    return headTestFilesP;
  };

  const changedProductionFiles = new Set(files.filter((f) => f.kind === 'production').map((f) => f.path));

  // paths.ignore keeps a file away from every rule, the config and workflow rules included (they read config files by
  // name wherever they sit). The gate's own config is never ignored, so W006 still sees a change to it.
  const ruleFiles = files.filter((f) => f.path.split('/').pop() === '.testwitness.yml' || !(ignore(f.path) && (!f.oldPath || ignore(f.oldPath))));

  const ctx: RuleContext = {
    files: ruleFiles,
    pairs,
    headInventoryFor: async (path) => {
      const lang = classifyPath(path, undefined).language;
      return inventory(headSha, path, lang);
    },
    headTestFiles,
    readBase: (p) => read(baseSha, p),
    readHead: (p) => read(headSha, p),
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
    ...(opts.coverage ? { coverage: opts.coverage } : {}),
    ...(opts.mutation ? { mutation: opts.mutation } : {}),
    ...(opts.prText ? { prText: opts.prText } : {}),
    profile,
    config: opts.config,
    fingerprint: makeFingerprint,
    changedProductionFiles,
  };

  // Rules
  const tRules0 = performance.now();
  const rules = opts.rules ?? builtinRules();
  const findings: Finding[] = [];
  let adjusted = 0;
  for (const rule of rules) {
    const configured = effectiveSeverity(rule, opts.config);
    if (configured === 'off') continue;
    if (rule.needs.includes('junit') && !opts.evidence) continue;
    if (rule.needs.includes('coverage') && !opts.coverage) continue;
    if (rule.needs.includes('mutation') && !opts.mutation) continue;
    const options = { ...(rule.defaultOptions ?? {}), ...(opts.config.rules[rule.id]?.options ?? {}) };
    let result: Finding[];
    try {
      result = await rule.run(ctx, options);
    } catch (err) {
      log(`rule ${rule.id} failed: ${(err as Error).stack ?? (err as Error).message}`);
      continue;
    }
    if (opts.history) adjusted += applyHistory(result, opts.history, files);
    for (const f of result) {
      f.severity = applyConfiguredSeverity(f.severity, configured, rule.defaultSeverity);
      findings.push(f);
    }
  }
  const rulesMs = performance.now() - tRules0;

  // Acknowledgements from config
  const acks = new Map(opts.config.acknowledge.map((a) => [a.fingerprint, a]));
  for (const f of findings) {
    const a = acks.get(f.fingerprint);
    if (a) f.acknowledged = { by: a.by, reason: a.reason, at: a.date, via: 'config' };
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.ruleId.localeCompare(b.ruleId) || a.location.path.localeCompare(b.location.path));

  // Provenance
  let provenance: ProvenanceInfo = { agents: [] };
  try {
    const msgs = await commitMessages(baseSha, headCommit, git);
    provenance = detectProvenance(msgs, opts.prText, opts.author);
  } catch {
    /* shallow clones may not have history; provenance is optional */
  }

  const state = computeState(findings, opts.config, opts.evidence, files);

  let history: HistorySummary | undefined;
  if (opts.history || opts.historySource !== undefined || opts.historyNotes?.length) {
    history = {
      source: opts.historySource ?? 'inline',
      runs: opts.history?.runs.length ?? 0,
      tests: opts.history ? Object.keys(opts.history.tests).length : 0,
      adjusted,
      notes: [...(opts.historyNotes ?? []), ...(opts.history?.truncated ? ['The history was truncated by the size cap; some tests have no record.'] : [])].slice(0, 10),
    };
  }
  let updatedHistory: HistoryDocument | undefined = opts.recordHistory ? opts.history : undefined;
  if (opts.recordHistory && opts.evidence && opts.evidence.total > 0) {
    const run = { id: opts.historyRun?.id || `local-${headCommit.slice(0, 10)}`, date: opts.historyRun?.date || new Date().toISOString().slice(0, 10) };
    updatedHistory = mergeHistory(opts.history, run, historyResults(opts.evidence));
  }
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) if (!f.acknowledged) counts[f.severity]++;

  const report: Report = {
    $schema: REPORT_SCHEMA,
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'testwitness', version: TOOL_VERSION },
    generatedAt: new Date().toISOString(),
    state,
    mode: opts.config.mode,
    summary: {
      testsDeleted: findings.filter((f) => (f.ruleId === 'R001' || f.ruleId === 'R002') && f.severity !== 'low').length,
      testsSkipped: findings.filter((f) => (f.ruleId === 'R003' || f.ruleId === 'R004') && f.severity !== 'low').length,
      assertionsWeakened: findings.filter((f) => f.ruleId.startsWith('A') && f.severity !== 'low').length,
      changedTestsNotRun: findings.filter((f) => f.ruleId === 'V003').length,
      findings: counts,
    },
    findings,
    evidence: {
      state: opts.evidence ? (opts.evidenceNotes?.some((n) => /partial/i.test(n)) ? 'partial' : 'read') : 'unreadable',
      sources: opts.evidence?.sources ?? [],
      formats: opts.evidence ? (opts.evidence.formats ?? ['junit-xml']) : [],
      total: opts.evidence?.total ?? 0,
      passed: opts.evidence?.passed ?? 0,
      failed: opts.evidence?.failed ?? 0,
      errored: opts.evidence?.errored ?? 0,
      skipped: opts.evidence?.skipped ?? 0,
      flaky: opts.evidence?.flaky ?? 0,
      notes: opts.evidenceNotes ?? (opts.evidence ? [] : ['No test results were found. Add a reporter (JUnit XML first) so changed tests can be checked against what ran.']),
    },
    provenance,
    files: {
      changed: files.length,
      tests: files.filter((f) => f.kind === 'test').length,
      production: files.filter((f) => f.kind === 'production').length,
      config: files.filter((f) => f.kind === 'runner-config' || f.kind === 'coverage-config').length,
      workflows: files.filter((f) => f.kind === 'ci-workflow').length,
      snapshots: files.filter((f) => f.kind === 'snapshot').length,
    },
    timing: { totalMs: Math.round(performance.now() - t0), parseMs: Math.round(parseMs), rulesMs: Math.round(rulesMs), evidenceMs: 0, ...(helperIndex ? { helperIndexMs: Math.round(helperIndexMs) } : {}) },
    ...(helperIndex ? { helperIndex } : {}),
    ...(opts.coverage
      ? { coverage: { sources: opts.coverage.sources, files: opts.coverage.files, linesInstrumented: opts.coverage.linesInstrumented, linesExecuted: opts.coverage.linesExecuted, notes: opts.coverage.warnings.slice(0, 10) } }
      : {}),
    ...(opts.mutation
      ? {
          mutation: {
            sources: opts.mutation.sources,
            files: opts.mutation.files,
            mutants: opts.mutation.mutants,
            killed: opts.mutation.killed,
            survived: opts.mutation.survived,
            noCoverage: opts.mutation.noCoverage,
            notes: opts.mutation.warnings.slice(0, 10),
          },
        }
      : {}),
    ...(history ? { history } : {}),
    base: baseSha,
    head: headCommit,
    ...(snapshot ? { headTree: snapshot.tree } : {}),
  };
  return { report, files, pairs, ...(updatedHistory ? { history: updatedHistory } : {}) };
}

/** pass, review or unreadable. */
export function computeState(findings: Finding[], cfg: ResolvedConfig, evidence: Evidence | undefined, files: ChangedFile[]): CheckState {
  const threshold: Severity = cfg.failOn;
  const open = findings.filter((f) => !f.acknowledged && SEVERITY_RANK[f.severity] >= SEVERITY_RANK[threshold]);
  const touchesTests = files.some((f) => f.kind === 'test' || f.kind === 'runner-config' || f.kind === 'ci-workflow');
  if (open.length > 0) return 'review';
  if (!evidence && touchesTests) return 'unreadable';
  return 'pass';
}

/** Exit code per spec 4.4. */
export function exitCodeFor(report: Report, cfg: ResolvedConfig): number {
  if (cfg.mode === 'report') return 0;
  if (report.state === 'review') return 1;
  if (report.state === 'unreadable' && cfg.mode === 'strict' && cfg.requireEvidence) return 3;
  return 0;
}
