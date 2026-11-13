import type { Evidence, TestStatus } from '@testwitness/core';
import { classKey } from '@testwitness/core';

/** Result formats the readers understand, told apart by content. docs/report.schema.json lists the same names. */
export const RESULT_FORMATS = ['junit-xml', 'tap', 'jest-json', 'vitest-json', 'pytest-json-report', 'playwright-json'] as const;
export type ResultFormat = (typeof RESULT_FORMATS)[number];

export interface TestRecord {
  /** Normalised lookup key. */
  key: string;
  classname: string;
  name: string;
  file?: string;
  status: TestStatus;
  timeMs?: number;
  /** Number of rerun/flaky child elements, retries, or extra invocations. */
  reruns: number;
  source: string;
}

export interface ResultIndexData {
  sources: string[];
  /** Formats of the files that were read. */
  formats: Set<ResultFormat>;
  records: Map<string, TestRecord>;
  /** Key prefix index: class key to keys. */
  byClass: Map<string, string[]>;
  totals: { total: number; passed: number; failed: number; errored: number; skipped: number; flaky: number };
  warnings: string[];
  /** Notes about the file and byte caps on results files, when they were hit. */
  limits: string[];
}

const RANK: Record<TestStatus, number> = { passed: 0, flaky: 1, skipped: 2, failed: 3, error: 4 };

export function addRecord(data: ResultIndexData, rec: TestRecord): void {
  // Duplicate keys (reruns written as separate testcases, parametrised names that normalise together, one
  // Playwright test run in several projects) keep the worst status.
  const existing = data.records.get(rec.key);
  if (existing) {
    // The same raw test written again in another file is a rerun (Surefire with rerunFailingTestsCount writes the
    // retry of a top level test into a second TEST-*.xml). Failed in one file and passed in another is flaky, not failed.
    const sameRawTest = existing.classname === rec.classname && existing.name === rec.name && existing.source !== rec.source;
    const outcomes = new Set([existing.status, rec.status]);
    const hasPass = outcomes.has('passed') || outcomes.has('flaky');
    const hasFail = outcomes.has('failed') || outcomes.has('error');
    if (sameRawTest && hasPass && hasFail) {
      existing.status = 'flaky';
      existing.reruns += rec.reruns + 1;
      return;
    }
    if (RANK[rec.status] > RANK[existing.status]) existing.status = rec.status;
    existing.reruns += rec.reruns;
    return;
  }
  data.records.set(rec.key, rec);
  const ck = classKey(rec.classname);
  const arr = data.byClass.get(ck);
  if (arr) arr.push(rec.key);
  else data.byClass.set(ck, [rec.key]);
}

export function emptyIndex(): ResultIndexData {
  return { sources: [], formats: new Set(), records: new Map(), byClass: new Map(), totals: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 }, warnings: [], limits: [] };
}

export function finaliseTotals(data: ResultIndexData): void {
  const t = { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 };
  for (const r of data.records.values()) {
    t.total++;
    switch (r.status) {
      case 'passed': t.passed++; break;
      case 'failed': t.failed++; break;
      case 'error': t.errored++; break;
      case 'skipped': t.skipped++; break;
      case 'flaky': t.flaky++; t.passed++; break;
    }
  }
  data.totals = t;
}

/** Adapt the index to the core Evidence interface. */
export function toEvidence(data: ResultIndexData): Evidence {
  return {
    sources: data.sources,
    formats: [...data.formats].sort(),
    total: data.totals.total,
    passed: data.totals.passed,
    failed: data.totals.failed,
    errored: data.totals.errored,
    skipped: data.totals.skipped,
    flaky: data.totals.flaky,
    has: (key) => data.records.has(key),
    statusOf: (key) => data.records.get(key)?.status,
    keysForClass: (ck) => data.byClass.get(ck) ?? [],
    keys: () => data.records.keys(),
    rerunsOf: (key) => data.records.get(key)?.reruns ?? 0,
  };
}
