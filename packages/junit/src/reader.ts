// @ts-nocheck
import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';
import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { Evidence, TestStatus } from '@testwitness/core';
import { normaliseKey, classKey } from '@testwitness/core';

export interface TestRecord {
  /** Normalised lookup key. */
  key: string;
  classname: string;
  name: string;
  file?: string;
  status: TestStatus;
  timeMs?: number;
  /** Number of rerun/flaky child elements. */
  reruns: number;
  source: string;
}

export interface ResultIndexData {
  sources: string[];
  records: Map<string, TestRecord>;
  /** Key prefix index: class key to keys. */
  byClass: Map<string, string[]>;
  totals: { total: number; passed: number; failed: number; errored: number; skipped: number; flaky: number };
  warnings: string[];
}

const FAIL_CHILDREN = new Set(['failure']);
const ERROR_CHILDREN = new Set(['error']);
const SKIP_CHILDREN = new Set(['skipped']);
const FLAKY_CHILDREN = new Set(['flakyFailure', 'flakyError']);
const RERUN_CHILDREN = new Set(['rerunFailure', 'rerunError']);

/**
 * Stream one JUnit XML file into the index. Only the elements and attributes
 * every producer agrees on are read: testsuite/@name, testcase/@name,
 * testcase/@classname, testcase/@file, and the child elements skipped,
 * failure, error, flakyFailure, flakyError, rerunFailure, rerunError.
 */
export function readJunitStream(stream: NodeJS.ReadableStream, source: string, data: ResultIndexData): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser({ xmlns: false, position: false });
    const suiteStack: string[] = [];
    interface Current { classname: string; name: string; file?: string; time?: string; status: TestStatus; reruns: number }
    let current: Current | undefined;
    let depthInsideCase = 0;
    let sawTestcase = false;

    parser.on('error', (e) => {
      data.warnings.push(`${source}: ${e.message}`);
      // saxes can continue after some errors; keep going.
    });

    parser.on('opentag', (tag: SaxesTagPlain) => {
      const name = tag.name;
      if (current) {
        depthInsideCase++;
        if (FAIL_CHILDREN.has(name)) current.status = 'failed';
        else if (ERROR_CHILDREN.has(name) && current.status !== 'failed') current.status = 'error';
        else if (SKIP_CHILDREN.has(name) && current.status === 'passed') current.status = 'skipped';
        else if (FLAKY_CHILDREN.has(name)) {
          current.reruns++;
          if (current.status === 'passed') current.status = 'flaky';
        } else if (RERUN_CHILDREN.has(name)) {
          current.reruns++;
        }
        return;
      }
      if (name === 'testsuite') {
        suiteStack.push(tag.attributes['name'] ?? '');
      } else if (name === 'testcase') {
        sawTestcase = true;
        const rec: Current = {
          classname: tag.attributes['classname'] ?? suiteStack[suiteStack.length - 1] ?? '',
          name: tag.attributes['name'] ?? '',
          status: 'passed',
          reruns: 0,
        };
        if (tag.attributes['file'] !== undefined) rec.file = tag.attributes['file'];
        if (tag.attributes['time'] !== undefined) rec.time = tag.attributes['time'];
        current = rec;
        depthInsideCase = 0;
      }
    });

    parser.on('closetag', (tag: SaxesTagPlain) => {
      if (current) {
        if (depthInsideCase > 0) {
          depthInsideCase--;
          return;
        }
        if (tag.name === 'testcase') {
          const key = normaliseKey(current.classname, current.name);
          const rec: TestRecord = {
            key,
            classname: current.classname,
            name: current.name,
            status: current.status,
            reruns: current.reruns,
            source,
          };
          if (current.file !== undefined) rec.file = current.file;
          if (current.time !== undefined) {
            const t = Number(current.time);
            if (!Number.isNaN(t)) rec.timeMs = Math.round(t * 1000);
          }
          addRecord(data, rec);
          current = undefined;
        }
        return;
      }
      if (tag.name === 'testsuite') suiteStack.pop();
    });

    // Buffers are decoded with a stateful decoder so a multibyte character that
    // straddles two read chunks (jest-junit titles use U+203A) is not turned into U+FFFD.
    const decoder = new StringDecoder('utf8');
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer | string) => {
      try {
        parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk));
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
    });
    stream.on('end', () => {
      try {
        const rest = decoder.end();
        if (rest) parser.write(rest);
        parser.close();
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
      if (!sawTestcase) data.warnings.push(`${source}: no testcase elements found`);
      data.sources.push(source);
      resolve();
    });
  });
}

function addRecord(data: ResultIndexData, rec: TestRecord): void {
  // Duplicate keys (reruns written as separate testcases, parametrised names that normalise together) keep the worst status.
  const existing = data.records.get(rec.key);
  if (existing) {
    const rank: Record<TestStatus, number> = { passed: 0, flaky: 1, skipped: 2, failed: 3, error: 4 };
    if (rank[rec.status] > rank[existing.status]) existing.status = rec.status;
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
  return { sources: [], records: new Map(), byClass: new Map(), totals: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 }, warnings: [] };
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

export async function readJunitFiles(paths: string[]): Promise<ResultIndexData> {
  const data = emptyIndex();
  for (const p of paths) {
    await readJunitStream(createReadStream(p), p, data);
  }
  finaliseTotals(data);
  return data;
}

export async function readJunitString(xml: string, source = 'inline.xml'): Promise<ResultIndexData> {
  const data = emptyIndex();
  const { Readable } = await import('node:stream');
  await readJunitStream(Readable.from([xml]), source, data);
  finaliseTotals(data);
  return data;
}

/** Adapt the index to the core Evidence interface. */
export function toEvidence(data: ResultIndexData): Evidence {
  return {
    sources: data.sources,
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
  };
}
