import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import {
  exitCodeFor,
  parseConfig,
  renderJson,
  renderMarkdown,
  ruleMap,
  runEngine,
  showFile,
  git,
  GitError,
  mergeBase,
  revParse,
  ConfigError,
  readCoverageFiles,
  readMutationFiles,
  readHistoryFile,
  serializeHistory,
  toCoverageEvidence,
  toMutationEvidence,
  type HistoryDocument,
  type MutationEvidence,
  type CoverageEvidence,
  type ChangedFile,
  type Evidence,
  type PullRequestText,
  type Report,
  type ResolvedConfig,
} from '@testwitness/core';
import { readResultsFiles, toEvidence } from '@testwitness/junit';
import { allFrontEnds } from './frontends.js';

export interface CheckOptions {
  cwd: string;
  /** Base ref; the merge base with head is compared. Default: the default branch (origin/HEAD's target). */
  base?: string;
  head: string;
  /**
   * Comma separated globs of test results: JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or
   * Playwright, told apart by content. Default from config `results.head` (or its older name `junit.head`).
   */
  results?: string | undefined;
  /** Older name of `results`; used when `results` is not given. */
  junit?: string | undefined;
  /** Comma separated globs of lcov, Cobertura or JaCoCo reports; default from config coverage.paths. */
  coverage?: string | undefined;
  /** Comma separated globs of Stryker JSON or PIT mutations.xml reports; default from config mutation.paths. */
  mutation?: string | undefined;
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
  /**
   * Follow symbolic links in the results, coverage, mutation and history paths (default from config
   * paths.followSymlinks, false). Off, a matched file that is a link, or whose real path is outside the repository
   * (or outside the directory an absolute glob names), is skipped with a note.
   */
  followSymlinks?: boolean | undefined;
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
  /** The changed files and the evidence the engine graded with, so a caller that changes findings afterwards (the Action's acknowledgements) recomputes the state from the same inputs. */
  files: ChangedFile[];
  evidence?: Evidence;
}

export async function loadConfig(opts: CheckOptions): Promise<ResolvedConfig> {
  const rules = ruleMap();
  let source: string | undefined;
  if (opts.config) {
    source = await readFile(resolve(opts.cwd, opts.config), 'utf8');
  } else {
    // Config is read from the base ref in PR mode so a PR cannot relax its own check.
    try {
      const baseSha = await mergeBase(opts.base ?? (await defaultBase(opts.cwd)), await revParse(opts.head, { cwd: opts.cwd }), { cwd: opts.cwd });
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

/**
 * The directory a glob is rooted at: its leading segments up to the first one with glob syntax, with escapes removed
 * (`out/x\\[1\\]/*.xml` is rooted at `out/x[1]`), or `.`. Patterns use forward slashes on every platform, so this
 * is the same on Windows and Linux; `C:/r/*.xml` gives `C:/r` and `//server/share/*.xml` gives `//server/share`.
 */
export function globBase(pattern: string): string {
  const fixed: string[] = [];
  for (const seg of pattern.split('/')) {
    // fast-glob calls a segment with an escaped bracket dynamic; only unescaped glob syntax makes it one.
    if (seg !== '' && fg.isDynamicPattern(seg.replace(/\\./g, 'x'))) break;
    fixed.push(seg.replace(/\\(.)/g, '$1'));
  }
  return fixed.join('/') || '.';
}

/** Directories a matched report file may really live in: the repository, and the fixed base of any glob that points outside it. */
function allowedRoots(cwd: string, patterns: string[]): string[] {
  const roots = new Set<string>();
  const real = (p: string): string | undefined => {
    try {
      return realpathSync(p);
    } catch {
      return undefined;
    }
  };
  const root = real(cwd) ?? resolve(cwd);
  roots.add(root);
  for (const pattern of patterns) {
    const base = resolve(cwd, globBase(pattern));
    const rel = relative(resolve(cwd), base);
    // Only a glob the workflow wrote with an absolute or `..` base reaches outside the repository on purpose.
    if (rel.startsWith('..') || isAbsolute(rel)) {
      const r = real(base);
      if (r) roots.add(r);
    }
  }
  return [...roots];
}

/**
 * Files matching the globs. Without followSymlinks, links are not followed: a matched file that is itself a link, or
 * whose real path lies outside the allowed roots (through a linked directory), is skipped, so a link committed by a
 * pull request cannot point the check at a file elsewhere on the runner.
 */
export async function matchReportFiles(cwd: string, patterns: string[], followSymlinks: boolean): Promise<{ files: string[]; notes: string[] }> {
  const opts = { cwd, absolute: true, ignore: ['**/node_modules/**'], dot: true };
  if (followSymlinks) return { files: (await fg(patterns, { ...opts, onlyFiles: true, followSymbolicLinks: true })).sort(), notes: [] };
  // Not following links, fast-glob neither enters a linked directory nor reports a linked file as a file; entries are
  // listed with their types so a linked file can be named in the note.
  const entries = await fg(patterns, { ...opts, onlyFiles: false, followSymbolicLinks: false, objectMode: true });
  const roots = allowedRoots(cwd, patterns);
  const kept: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) if (e.dirent.isSymbolicLink()) skipped.push(e.path);
  // A glob whose fixed base is a link (bazel-testlogs/**) is not entered at all; say so.
  for (const pattern of patterns) {
    const fixedBase = globBase(pattern);
    const base = resolve(cwd, fixedBase);
    try {
      // fast-glob names entries with forward slashes on Windows too, so compare resolved forms.
      if (fixedBase !== '.' && lstatSync(base).isSymbolicLink() && !skipped.some((s) => resolve(s) === base)) skipped.push(base);
    } catch {
      /* no such base: nothing matched */
    }
  }
  const files = entries.filter((e) => e.dirent.isFile()).map((e) => e.path);
  for (const f of files.sort()) {
    let ok = false;
    try {
      if (!lstatSync(f).isSymbolicLink()) {
        const r = realpathSync(f);
        ok = roots.some((root) => r === root || r.startsWith(root.endsWith(sep) ? root : root + sep));
      }
    } catch {
      ok = false;
    }
    if (ok) kept.push(f);
    else skipped.push(f);
  }
  skipped.sort();
  const notes = skipped.length
    ? [`${skipped.length} matched path${skipped.length === 1 ? ' was' : 's were'} skipped because ${skipped.length === 1 ? 'it is' : 'they are'} a symbolic link or outside the repository (${skipped.slice(0, 3).map((f) => relative(cwd, f)).join(', ')}${skipped.length > 3 ? ', ...' : ''}); set paths.followSymlinks or --follow-symlinks to read linked outputs`]
    : [];
  return { files: kept, notes };
}

/**
 * Comma separated globs as fast-glob patterns. fast-glob only understands forward slashes: on
 * Windows a pattern built with path.join arrives with backslashes, so convert those; a pattern
 * without backslashes is left alone so that glob syntax such as [abc] keeps its meaning. On
 * Windows a backslash is a separator, never an escape, so in a converted pattern brackets,
 * braces and parentheses of the path are literal. Only `platform` decides the result, not the
 * platform this runs on, so tests run the Windows logic everywhere.
 */
export function splitGlobs(globs: string, platform: NodeJS.Platform = process.platform): string[] {
  return globs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (platform === 'win32' && p.includes('\\') ? windowsGlobToPattern(p) : p));
}

/**
 * A Windows glob (backslashes) as a fast-glob pattern. Every backslash is a separator, and brackets, braces and
 * parentheses are literal parts of the path, while `*` and `?` stay glob syntax. fast-glob's own
 * convertPathToPattern reads a backslash in front of a bracket as an escape, so `C:\\app\\[id]\\*.xml` lost the
 * separator and became the directory `app[id]`.
 */
export function windowsGlobToPattern(p: string): string {
  const pattern = p
    .split(/[\\/]/)
    .map((seg) => seg.replace(/[()[\]{}]/g, '\\$&'))
    .join('/');
  return pattern.startsWith('!') ? `\\${pattern}` : pattern;
}

/**
 * A literal file path (not a glob) as a fast-glob pattern that matches only that file: on Windows the path is
 * converted (backslashes to slashes, glob characters escaped), elsewhere glob characters are escaped. The history
 * path is one: on a Windows runner it is C:\\...\\history.json, and fg.escapePath kept its backslashes, which
 * fast-glob then reads as escapes, so a history outside the repository (the Action downloads it to the temp
 * directory) was reported as a symbolic link or outside the repository and not read.
 */
export function pathToPattern(p: string, platform: NodeJS.Platform = process.platform): string {
  // Windows file names cannot hold * or ?, so the glob conversion is exact for a path.
  return platform === 'win32' ? windowsGlobToPattern(p) : fg.posix.escapePath(p);
}

export async function loadEvidence(cwd: string, globs: string, log: (s: string) => void, followSymlinks = false): Promise<{ evidence: Evidence | undefined; notes: string[] }> {
  const patterns = splitGlobs(globs);
  if (!patterns.length) return { evidence: undefined, notes: [] };
  const matched = await matchReportFiles(cwd, patterns, followSymlinks);
  for (const n of matched.notes) log(n);
  if (!matched.files.length) {
    log(`no test results matched ${globs}`);
    return { evidence: undefined, notes: matched.notes };
  }
  const data = await readResultsFiles(matched.files);
  // Cap and link notes first, so they are never cut by the ten warning limit.
  const all = [...matched.notes, ...data.limits, ...data.warnings];
  const notes = all.slice(0, 10);
  if (all.length > 10) notes.push(`${all.length - 10} more warnings`);
  if (!data.sources.length) {
    for (const w of notes) log(w);
    return { evidence: undefined, notes };
  }
  return { evidence: toEvidence(data), notes };
}

export async function loadCoverage(cwd: string, globs: string, log: (s: string) => void, followSymlinks = false): Promise<CoverageEvidence | undefined> {
  const patterns = splitGlobs(globs);
  if (!patterns.length) return undefined;
  const matched = await matchReportFiles(cwd, patterns, followSymlinks);
  for (const n of matched.notes) log(n);
  if (!matched.files.length) {
    log(`no coverage report matched ${globs}`);
    return undefined;
  }
  const data = await readCoverageFiles(matched.files, cwd);
  data.warnings.unshift(...matched.notes);
  for (const w of data.warnings.slice(0, 10)) log(w);
  if (!data.sources.length) return undefined;
  return toCoverageEvidence(data);
}

export async function loadMutation(cwd: string, globs: string, log: (s: string) => void, followSymlinks = false): Promise<MutationEvidence | undefined> {
  const patterns = splitGlobs(globs);
  if (!patterns.length) return undefined;
  const matched = await matchReportFiles(cwd, patterns, followSymlinks);
  for (const n of matched.notes) log(n);
  if (!matched.files.length) {
    log(`no mutation report matched ${globs}`);
    return undefined;
  }
  const data = await readMutationFiles(matched.files, cwd);
  data.warnings.unshift(...matched.notes);
  for (const w of data.warnings.slice(0, 10)) log(w);
  if (!data.sources.length) return undefined;
  return toMutationEvidence(data);
}

/** Base ref when the caller gives none: origin's default branch, then origin/main, origin/master, main, master. */
export async function defaultBase(cwd: string): Promise<string> {
  try {
    const head = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd })).trim();
    if (head.startsWith('refs/remotes/')) return head.slice('refs/remotes/'.length);
  } catch {
    /* no origin/HEAD: try the usual names */
  }
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await resolves(cwd, candidate)) return candidate;
  }
  return 'origin/main';
}

async function resolves(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * The base ref to compare against: the one given, or the default branch (origin/HEAD's target). A ref that does not
 * name a commit fails with a message naming the default branch, instead of git's raw "Not a valid object name".
 */
export async function resolveBase(cwd: string, base: string | undefined): Promise<string> {
  const ref = base ?? (await defaultBase(cwd));
  if (await resolves(cwd, ref)) return ref;
  const fallback = await defaultBase(cwd);
  const hint = fallback !== ref && (await resolves(cwd, fallback)) ? ` The default branch is ${fallback}; pass --base ${fallback}, or the branch the pull request targets.` : ' Fetch the branch the pull request targets (git fetch origin) and pass it with --base.';
  throw new GitError(`base ref ${ref} does not name a commit in this repository.${hint}`, ['rev-parse', ref], '');
}

/** Note for a comparison with nothing in it: the merge base is the head itself. */
export function nothingToCompare(base: string, head: string): string {
  return `Nothing to compare: ${head} is already contained in ${base}, so the merge base is the head itself and no change was checked. To check a pull request before it merges, use the branch it targets as --base and its branch as --head; once it is merged with a merge commit, use the first parent of that merge commit as --base.`;
}

export async function check(opts: CheckOptions): Promise<CheckResult> {
  const log = opts.log ?? ((s: string) => { if (!opts.quiet) process.stderr.write(`testwitness: ${s}\n`); });
  const base = await resolveBase(opts.cwd, opts.base);
  opts = { ...opts, base };
  const config = await loadConfig(opts);
  const follow = opts.followSymlinks ?? config.paths.followSymlinks;
  const { evidence, notes } = await loadEvidence(opts.cwd, opts.results ?? opts.junit ?? config.junit.head, log, follow);
  const coverage = await loadCoverage(opts.cwd, opts.coverage ?? config.coverage.paths.join(','), log, follow);
  const mutation = await loadMutation(opts.cwd, opts.mutation ?? config.mutation.paths.join(','), log, follow);
  let prText: PullRequestText | undefined;
  if (opts.prTitle !== undefined || opts.prBodyFile || opts.prBody !== undefined) {
    const body = opts.prBody ?? (opts.prBodyFile ? await readFile(resolve(opts.cwd, opts.prBodyFile), 'utf8') : '');
    prText = { title: opts.prTitle ?? '', body };
  }
  let history: HistoryDocument | undefined;
  const historyNotes = [...(opts.historyNotes ?? [])];
  if (opts.history) {
    const allowed = (await matchReportFiles(opts.cwd, [pathToPattern(opts.history)], follow)).files.length > 0 || !existsSync(resolve(opts.cwd, opts.history));
    const read = allowed ? await readHistoryFile(resolve(opts.cwd, opts.history)) : { doc: undefined, error: `history ${opts.history} is a symbolic link or outside the repository; set paths.followSymlinks or --follow-symlinks to read it` };
    if (read.doc) history = read.doc;
    else {
      historyNotes.push(`${read.error}; severities do not use history in this run.`);
      log(read.error!);
    }
  }
  const runAttempt = process.env['GITHUB_RUN_ATTEMPT'];
  const runId = opts.runId ?? (process.env['GITHUB_RUN_ID'] ? `${process.env['GITHUB_RUN_ID']}${runAttempt && runAttempt !== '1' ? `.${runAttempt}` : ''}` : undefined);
  const { report, files, history: updated } = await runEngine({
    cwd: opts.cwd,
    base,
    head: opts.head,
    frontEnds: allFrontEnds(),
    config,
    evidence,
    evidenceNotes: notes,
    coverage,
    mutation,
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
  if (report.base === report.head && report.files.changed === 0) {
    // The head is inside the base (a PR merged with a merge commit, or the default branch itself): say so, never pass.
    const note = nothingToCompare(base, opts.head);
    report.state = 'unreadable';
    report.notes = [note];
    log(note);
  }
  if (opts.historyOut && updated) {
    const out = resolve(opts.cwd, opts.historyOut);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, serializeHistory(updated));
    log(`history: ${updated.runs.length} runs, ${Object.keys(updated.tests).length} tests written to ${opts.historyOut}`);
  } else if (opts.historyOut) {
    log('history: no results were read and no history was given, so no history was written');
  }
  return { report, exitCode: exitCodeFor(report, config), config, files, ...(evidence ? { evidence } : {}), ...(updated ? { history: updated } : {}) };
}

export function render(report: Report, format: CheckOptions['format'], collapseLow: boolean): string {
  if (format === 'json') return renderJson(report);
  if (format === 'markdown') return renderMarkdown(report, { collapseLow, marker: false });
  return renderMarkdown(report, { collapseLow, marker: false }) + '\n' + renderJson(report);
}

export { ConfigError };
