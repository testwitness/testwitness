import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import fg from 'fast-glob';
import {
  exitCodeFor,
  parseConfig,
  renderJson,
  renderMarkdown,
  ruleMap,
  runEngine,
  showFile,
  mergeBase,
  revParse,
  ConfigError,
  readCoverageFiles,
  readHistoryFile,
  serializeHistory,
  toCoverageEvidence,
  type HistoryDocument,
  type CoverageEvidence,
  type Evidence,
  type PullRequestText,
  type Report,
  type ResolvedConfig,
} from '@testwitness/core';
import { readJunitFiles, toEvidence } from '@testwitness/junit';
import { allFrontEnds } from './frontends.js';

export interface CheckOptions {
  cwd: string;
  base: string;
  head: string;
  junit?: string | undefined;
  /** Comma separated globs of lcov, Cobertura or JaCoCo reports; default from config coverage.paths. */
  coverage?: string | undefined;
  /** Path to .testwitness.yml; default reads it from the base ref, then the working tree. */
  config?: string | undefined;
  format: 'json' | 'markdown' | 'both';
  out?: string | undefined;
  prTitle?: string | undefined;
  prBodyFile?: string | undefined;
  /** Pull request body as text; takes precedence over prBodyFile. */
  prBody?: string | undefined;
  /** PR author login, for provenance display only. */
  author?: string | undefined;
  /** PR author account type, e.g. User or Bot. */
  authorType?: string | undefined;
  mode?: ResolvedConfig['mode'] | undefined;
  failOn?: ResolvedConfig['failOn'] | undefined;
  quiet?: boolean;
  /** Run history JSON to read (docs/history.md). No default: without it severities do not depend on earlier runs. */
  history?: string | undefined;
  /** How to name the history source in the report; default the history path. */
  historySource?: string | undefined;
  /** Notes about the history to carry into the report (the Action explains why none was downloaded). */
  historyNotes?: string[] | undefined;
  /** Write the history with this run merged in. No default. */
  historyOut?: string | undefined;
  /** Return the history with this run merged in as CheckResult.history, without writing it (the Action writes it). */
  recordHistory?: boolean;
  /** Id of this run in the history; default GITHUB_RUN_ID, then local-<head sha>. */
  runId?: string | undefined;
  /** Index assertion helpers in test support files of the working tree (default true). The environment variable TESTWITNESS_HELPER_INDEX=off also turns it off. */
  helperIndex?: boolean;
  log?: (s: string) => void;
}

export interface CheckResult {
  report: Report;
  exitCode: number;
  config: ResolvedConfig;
  /** The history with this run merged in, when a history was read or results were read. */
  history?: HistoryDocument;
}

export async function loadConfig(opts: CheckOptions): Promise<ResolvedConfig> {
  const rules = ruleMap();
  let source: string | undefined;
  if (opts.config) {
    source = await readFile(resolve(opts.cwd, opts.config), 'utf8');
  } else {
    // Config is read from the base ref in PR mode so a PR cannot relax its own check.
    try {
      const baseSha = await mergeBase(opts.base, await revParse(opts.head, { cwd: opts.cwd }), { cwd: opts.cwd });
      source = await showFile(baseSha, '.testwitness.yml', { cwd: opts.cwd });
    } catch {
      source = undefined;
    }
    if (source === undefined) {
      const local = resolve(opts.cwd, '.testwitness.yml');
      if (existsSync(local)) source = await readFile(local, 'utf8');
    }
  }
  const cfg = parseConfig(source, rules);
  if (opts.mode) cfg.mode = opts.mode;
  if (opts.failOn) cfg.failOn = opts.failOn;
  return cfg;
}

export async function loadEvidence(cwd: string, globs: string, log: (s: string) => void): Promise<{ evidence: Evidence | undefined; notes: string[] }> {
  // fast-glob only understands forward slashes. On Windows a pattern built with path.join
  // arrives with backslashes, so convert those; a pattern without backslashes is left alone
  // so that glob syntax such as [abc] keeps its meaning.
  const patterns = globs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (process.platform === 'win32' && p.includes('\\') ? fg.convertPathToPattern(p) : p));
  if (!patterns.length) return { evidence: undefined, notes: [] };
  const files = await fg(patterns, { cwd, absolute: true, onlyFiles: true, ignore: ['**/node_modules/**'], dot: true });
  if (!files.length) {
    log(`no JUnit XML matched ${globs}`);
    return { evidence: undefined, notes: [] };
  }
  const data = await readJunitFiles(files.sort());
  const notes = data.warnings.slice(0, 10);
  if (data.warnings.length > 10) notes.push(`${data.warnings.length - 10} more warnings`);
  return { evidence: toEvidence(data), notes };
}

export async function loadCoverage(cwd: string, globs: string, log: (s: string) => void): Promise<CoverageEvidence | undefined> {
  const patterns = globs.split(',').map((s) => s.trim()).filter(Boolean);
  if (!patterns.length) return undefined;
  const files = await fg(patterns, { cwd, absolute: true, onlyFiles: true, ignore: ['**/node_modules/**'], dot: true });
  if (!files.length) {
    log(`no coverage report matched ${globs}`);
    return undefined;
  }
  const data = await readCoverageFiles(files.sort(), cwd);
  for (const w of data.warnings.slice(0, 10)) log(w);
  if (!data.sources.length) return undefined;
  return toCoverageEvidence(data);
}

export async function check(opts: CheckOptions): Promise<CheckResult> {
  const log = opts.log ?? ((s: string) => { if (!opts.quiet) process.stderr.write(`testwitness: ${s}\n`); });
  const config = await loadConfig(opts);
  const { evidence, notes } = await loadEvidence(opts.cwd, opts.junit ?? config.junit.head, log);
  const coverage = await loadCoverage(opts.cwd, opts.coverage ?? config.coverage.paths.join(','), log);
  let prText: PullRequestText | undefined;
  if (opts.prTitle !== undefined || opts.prBodyFile || opts.prBody !== undefined) {
    const body = opts.prBody ?? (opts.prBodyFile ? await readFile(resolve(opts.cwd, opts.prBodyFile), 'utf8') : '');
    prText = { title: opts.prTitle ?? '', body };
  }
  let history: HistoryDocument | undefined;
  const historyNotes = [...(opts.historyNotes ?? [])];
  if (opts.history) {
    const read = await readHistoryFile(resolve(opts.cwd, opts.history));
    if (read.doc) history = read.doc;
    else {
      historyNotes.push(`${read.error}; severities do not use history in this run.`);
      log(read.error!);
    }
  }
  const runAttempt = process.env['GITHUB_RUN_ATTEMPT'];
  const runId = opts.runId ?? (process.env['GITHUB_RUN_ID'] ? `${process.env['GITHUB_RUN_ID']}${runAttempt && runAttempt !== '1' ? `.${runAttempt}` : ''}` : undefined);
  const { report, history: updated } = await runEngine({
    cwd: opts.cwd,
    base: opts.base,
    head: opts.head,
    frontEnds: allFrontEnds(),
    config,
    evidence,
    evidenceNotes: notes,
    coverage,
    prText,
    ...(opts.author ? { author: { login: opts.author, type: opts.authorType } } : {}),
    ...(opts.helperIndex === false || process.env['TESTWITNESS_HELPER_INDEX'] === 'off' ? { helperIndex: false as const } : {}),
    history,
    historySource: opts.history || opts.historySource !== undefined || historyNotes.length ? (opts.historySource ?? opts.history ?? 'none') : undefined,
    historyNotes,
    historyRun: { id: runId },
    recordHistory: opts.recordHistory === true || opts.historyOut !== undefined,
    log,
  });
  if (opts.historyOut && updated) {
    const out = resolve(opts.cwd, opts.historyOut);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, serializeHistory(updated));
    log(`history: ${updated.runs.length} runs, ${Object.keys(updated.tests).length} tests written to ${opts.historyOut}`);
  } else if (opts.historyOut) {
    log('history: no results were read and no history was given, so no history was written');
  }
  return { report, exitCode: exitCodeFor(report, config), config, ...(updated ? { history: updated } : {}) };
}

export function render(report: Report, format: CheckOptions['format'], collapseLow: boolean): string {
  if (format === 'json') return renderJson(report);
  if (format === 'markdown') return renderMarkdown(report, { collapseLow, marker: false });
  return renderMarkdown(report, { collapseLow, marker: false }) + '\n' + renderJson(report);
}

export { ConfigError };
