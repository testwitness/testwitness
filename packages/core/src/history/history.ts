/**
 * Run history: what each test did in the last N runs of the same workflow, so severities can depend on counting.
 *
 * The document (docs/history.schema.json, schemaVersion "1") holds, oldest run first, the id, date and totals of the
 * last N runs, and per test key one string with one character per run, aligned with `runs`:
 *
 *   P passed   K flaky (failed, then passed on a rerun)   S skipped
 *   F failed   f failed after reruns                       E error   e error after reruns
 *   - no record of the test in that run
 *
 * Keys are the normalised `classKey::nameKey` the JUnit reader builds. Nothing else about a test is stored: no source,
 * no file paths, no PR text, no author. Merging, the window and the size cap are pure functions over this shape, so
 * the same inputs always give the same document. See docs/history.md.
 */

import type { TestStatus } from '../types.js';

export const HISTORY_SCHEMA = 'https://testwitness.github.io/testwitness/history.schema.json';
export const HISTORY_SCHEMA_VERSION = '1' as const;
/** Runs kept per document. */
export const HISTORY_WINDOW = 20;
/** Runs per test that the "hides failure" count looks at. */
export const HISTORY_RECENT = 5;
/** Serialised size cap; the oldest runs roll off first. */
export const HISTORY_MAX_BYTES = 5 * 1024 * 1024;

export type HistoryOutcome = 'P' | 'K' | 'S' | 'F' | 'f' | 'E' | 'e' | '-';
const OUTCOMES = new Set<string>(['P', 'K', 'S', 'F', 'f', 'E', 'e', '-']);

export interface HistoryRun {
  /** Workflow run id in the Action, `--run-id` or `local-<head sha>` in the CLI. */
  id: string;
  /** UTC date of the run, YYYY-MM-DD. */
  date: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  flaky: number;
}

export interface HistoryDocument {
  $schema: string;
  schemaVersion: '1';
  /** Maximum number of runs the document keeps. */
  window: number;
  /** Oldest first. */
  runs: HistoryRun[];
  /** Per test key, one outcome character per run, aligned with `runs`. */
  tests: Record<string, string>;
  /** Set when the size cap had to drop test keys from a single run. */
  truncated?: boolean;
}

/** One test record of the current run, as the JUnit reader gives it. */
export interface HistoryResult {
  key: string;
  status: TestStatus;
  reruns: number;
}

export function emptyHistory(window = HISTORY_WINDOW): HistoryDocument {
  return { $schema: HISTORY_SCHEMA, schemaVersion: HISTORY_SCHEMA_VERSION, window, runs: [], tests: {} };
}

export function outcomeOf(status: TestStatus, reruns: number): HistoryOutcome {
  switch (status) {
    case 'passed':
      return reruns > 0 ? 'K' : 'P';
    case 'flaky':
      return 'K';
    case 'skipped':
      return 'S';
    case 'failed':
      return reruns > 0 ? 'f' : 'F';
    case 'error':
      return reruns > 0 ? 'e' : 'E';
  }
}

const isFail = (c: string): boolean => c === 'F' || c === 'f' || c === 'E' || c === 'e';
const isPass = (c: string): boolean => c === 'P' || c === 'K';
const hasReruns = (c: string): boolean => c === 'K' || c === 'f' || c === 'e';

/** Parse and validate a history document. Returns undefined with a reason when the text is not a version 1 document. */
export function parseHistory(text: string): { doc?: HistoryDocument; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `history is not JSON: ${(err as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'history is not a JSON object' };
  const o = raw as Record<string, unknown>;
  if (o['schemaVersion'] !== HISTORY_SCHEMA_VERSION) return { error: `history schemaVersion ${JSON.stringify(o['schemaVersion'])} is not supported (expected "1")` };
  const window = o['window'];
  if (typeof window !== 'number' || !Number.isInteger(window) || window < 1) return { error: 'history window is not a positive integer' };
  if (!Array.isArray(o['runs'])) return { error: 'history runs is not an array' };
  const runs: HistoryRun[] = [];
  for (const r of o['runs'] as unknown[]) {
    if (!r || typeof r !== 'object') return { error: 'history run is not an object' };
    const x = r as Record<string, unknown>;
    if (typeof x['id'] !== 'string' || typeof x['date'] !== 'string') return { error: 'history run lacks id or date' };
    const num = (k: string): number => (typeof x[k] === 'number' && Number.isInteger(x[k]) && (x[k] as number) >= 0 ? (x[k] as number) : -1);
    const run: HistoryRun = { id: x['id'], date: x['date'], total: num('total'), passed: num('passed'), failed: num('failed'), errored: num('errored'), skipped: num('skipped'), flaky: num('flaky') };
    if (Object.values(run).some((v) => v === -1)) return { error: `history run ${x['id']} has a missing or negative count` };
    runs.push(run);
  }
  const t = o['tests'];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: 'history tests is not an object' };
  const tests: Record<string, string> = {};
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
    if (typeof v !== 'string' || v.length !== runs.length || [...v].some((c) => !OUTCOMES.has(c))) return { error: `history entry for ${k} does not have one outcome per run` };
    tests[k] = v;
  }
  const doc: HistoryDocument = { $schema: typeof o['$schema'] === 'string' ? o['$schema'] : HISTORY_SCHEMA, schemaVersion: HISTORY_SCHEMA_VERSION, window, runs, tests };
  if (o['truncated'] === true) doc.truncated = true;
  return { doc };
}

/** Serialise with sorted keys, one test per line, so the document diffs well and is byte for byte reproducible. */
export function serializeHistory(doc: HistoryDocument): string {
  const keys = Object.keys(doc.tests).sort();
  const lines: string[] = ['{'];
  lines.push(`  "$schema": ${JSON.stringify(doc.$schema)},`);
  lines.push(`  "schemaVersion": "1",`);
  lines.push(`  "window": ${doc.window},`);
  if (doc.truncated) lines.push(`  "truncated": true,`);
  lines.push(`  "runs": [${doc.runs.length ? '' : ']' + ','}`);
  doc.runs.forEach((r, i) => {
    const run = { id: r.id, date: r.date, total: r.total, passed: r.passed, failed: r.failed, errored: r.errored, skipped: r.skipped, flaky: r.flaky };
    lines.push(`    ${JSON.stringify(run)}${i === doc.runs.length - 1 ? '' : ','}`);
  });
  if (doc.runs.length) lines.push('  ],');
  lines.push(`  "tests": {${keys.length ? '' : '}'}`);
  keys.forEach((k, i) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(doc.tests[k])}${i === keys.length - 1 ? '' : ','}`));
  if (keys.length) lines.push('  }');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Drop the oldest `n` runs from every entry and remove entries with no record left. */
function dropOldest(doc: HistoryDocument, n: number): void {
  if (n <= 0) return;
  doc.runs = doc.runs.slice(n);
  for (const k of Object.keys(doc.tests)) {
    const s = doc.tests[k]!.slice(n);
    if (/^-*$/.test(s)) delete doc.tests[k];
    else doc.tests[k] = s;
  }
}

export interface MergeOptions {
  window?: number;
  maxBytes?: number;
}

/**
 * Append the current run to the history. A run whose id is already in the document (a re-run of the same workflow
 * run) replaces that column. The window keeps the newest `window` runs; then the oldest runs roll off until the
 * serialised document fits `maxBytes`. The newest run is never dropped; if it alone does not fit, test keys are
 * dropped in reverse sorted order and `truncated` is set. Returns a new document; the input is not modified.
 */
export function mergeHistory(prev: HistoryDocument | undefined, run: Pick<HistoryRun, 'id' | 'date'>, results: Iterable<HistoryResult>, opts: MergeOptions = {}): HistoryDocument {
  const window = Math.max(1, opts.window ?? prev?.window ?? HISTORY_WINDOW);
  const maxBytes = opts.maxBytes ?? HISTORY_MAX_BYTES;
  const doc: HistoryDocument = prev ? { ...prev, window, runs: [...prev.runs], tests: { ...prev.tests } } : emptyHistory(window);
  delete doc.truncated;
  // Replace a column with the same run id.
  const same = doc.runs.findIndex((r) => r.id === run.id);
  if (same !== -1) {
    doc.runs.splice(same, 1);
    for (const k of Object.keys(doc.tests)) {
      const s = doc.tests[k]!;
      const next = s.slice(0, same) + s.slice(same + 1);
      if (/^-*$/.test(next)) delete doc.tests[k];
      else doc.tests[k] = next;
    }
  }
  const totals = { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 };
  const current = new Map<string, HistoryOutcome>();
  for (const r of results) {
    const o = outcomeOf(r.status, r.reruns);
    const had = current.get(r.key);
    // Duplicate keys keep the worst outcome, as the reader does.
    if (had === undefined || rankOf(o) > rankOf(had)) current.set(r.key, o);
  }
  for (const o of current.values()) {
    totals.total++;
    if (o === 'P') totals.passed++;
    else if (o === 'K') {
      totals.passed++;
      totals.flaky++;
    } else if (o === 'S') totals.skipped++;
    else if (o === 'F' || o === 'f') totals.failed++;
    else totals.errored++;
  }
  const width = doc.runs.length;
  doc.runs.push({ id: run.id, date: run.date, ...totals });
  for (const k of Object.keys(doc.tests)) doc.tests[k] = doc.tests[k]! + (current.get(k) ?? '-');
  for (const [k, o] of current) if (doc.tests[k] === undefined) doc.tests[k] = '-'.repeat(width) + o;
  dropOldest(doc, doc.runs.length - window);
  // Size cap: roll off the oldest runs, never the newest.
  let size = Buffer.byteLength(serializeHistory(doc));
  while (size > maxBytes && doc.runs.length > 1) {
    dropOldest(doc, 1);
    size = Buffer.byteLength(serializeHistory(doc));
  }
  if (size > maxBytes) {
    const keys = Object.keys(doc.tests).sort();
    doc.truncated = true;
    let bytes = Buffer.byteLength(serializeHistory({ ...doc, tests: {} }));
    const kept: Record<string, string> = {};
    for (const k of keys) {
      const line = Buffer.byteLength(`    ${JSON.stringify(k)}: ${JSON.stringify(doc.tests[k])},\n`);
      if (bytes + line > maxBytes) break;
      kept[k] = doc.tests[k]!;
      bytes += line;
    }
    doc.tests = kept;
  }
  return doc;
}

function rankOf(o: HistoryOutcome): number {
  return { '-': 0, P: 1, K: 2, S: 3, F: 4, f: 5, E: 6, e: 7 }[o];
}

/** What the history says about one test key. */
export interface HistoryStats {
  /** Runs in the window with a record of the test. */
  seen: number;
  /** The last HISTORY_RECENT runs in which the test has a record (fewer when it has fewer). */
  recentRuns: number;
  /** Failed or errored among those recent runs. */
  recentFailed: number;
  /** Passed (including flaky) in the window. */
  passed: number;
  /** Failed or errored in the window. */
  failed: number;
  /** Runs in the window with reruns (flaky, or failed or errored after reruns). */
  rerunRuns: number;
  /** Passed and failed within the window, or reruns in at least 2 runs. */
  flaky: boolean;
  /** Recorded in every one of the last HISTORY_RECENT runs of the document (false when it has fewer runs). */
  seenInEveryRecentRun: boolean;
}

export function statsFor(doc: HistoryDocument, key: string): HistoryStats | undefined {
  const s = doc.tests[key];
  if (s === undefined) return undefined;
  const recorded = [...s].filter((c) => c !== '-');
  const recent = recorded.slice(-HISTORY_RECENT);
  const passed = recorded.filter(isPass).length;
  const failed = recorded.filter(isFail).length;
  const rerunRuns = recorded.filter(hasReruns).length;
  const tail = s.slice(-HISTORY_RECENT);
  return {
    seen: recorded.length,
    recentRuns: recent.length,
    recentFailed: recent.filter(isFail).length,
    passed,
    failed,
    rerunRuns,
    flaky: (passed > 0 && failed > 0) || rerunRuns >= 2,
    seenInEveryRecentRun: doc.runs.length >= HISTORY_RECENT && tail.length === HISTORY_RECENT && !tail.includes('-'),
  };
}

/** The first candidate key the history knows, with its stats. */
export function lookupHistory(doc: HistoryDocument, keys: string[]): { key: string; stats: HistoryStats } | undefined {
  for (const k of keys) {
    const stats = statsFor(doc, k);
    if (stats) return { key: k, stats };
  }
  return undefined;
}

/** Read a history file. A missing, oversized or invalid file gives an error string and no document; the run goes on without history. */
export async function readHistoryFile(path: string): Promise<{ doc?: HistoryDocument; error?: string }> {
  const { readFile, stat } = await import('node:fs/promises');
  try {
    const st = await stat(path);
    if (!st.isFile()) return { error: `history ${path} is not a file` };
    if (st.size > HISTORY_MAX_BYTES * 2) return { error: `history ${path} is ${st.size} bytes, over the ${HISTORY_MAX_BYTES * 2} byte read limit` };
  } catch {
    return { error: `history ${path} does not exist` };
  }
  return parseHistory(await readFile(path, 'utf8'));
}
