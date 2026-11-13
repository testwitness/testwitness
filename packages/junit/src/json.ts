/**
 * Readers for the JSON reporters of Jest (`jest --json --outputFile`), Vitest (`vitest run --reporter=json
 * --outputFile`), pytest-json-report (`pytest --json-report --json-report-file`) and Playwright Test (`--reporter=json`).
 *
 * Each is one JSON document with no record boundary, so it is read whole within the byte cap and parsed with
 * JSON.parse; nothing in it is evaluated. The shape, not the file name, says which reporter wrote it:
 *   testResults[].assertionResults[]          Jest or Vitest (Jest also writes numRuntimeErrorTestSuites and openHandles)
 *   tests[].nodeid with summary.collected     pytest-json-report
 *   suites[] with config and stats            Playwright
 * Keys are the ones the JUnit XML reader builds for the same runner's junit output, so a test has the same key
 * whichever reporter wrote the results:
 *   Jest, Vitest   test file :: ancestor titles and title joined by ` › `   (the Vitest junit shape)
 *   pytest         dotted module[.Class] :: function[param id]               (the pytest junitxml shape)
 *   Playwright     spec file :: describe titles and title joined by ` › `   (the Playwright junit shape)
 */
import type { TestStatus } from '@testwitness/core';
import { normaliseKey } from '@testwitness/core';
import type { ResultFormat, ResultIndexData, TestRecord } from './records.js';
import { addRecord } from './records.js';

type Json = Record<string, unknown>;

/** Terminal colour codes Playwright leaves in error messages. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Which JSON reporter wrote this document, or undefined when it is none of them. */
export function detectJsonFormat(doc: unknown): Exclude<ResultFormat, 'junit-xml' | 'tap'> | undefined {
  if (!isObj(doc)) return undefined;
  if (Array.isArray(doc['testResults'])) {
    return 'numRuntimeErrorTestSuites' in doc || 'openHandles' in doc || 'wasInterrupted' in doc ? 'jest-json' : 'vitest-json';
  }
  if (Array.isArray(doc['tests']) && (isObj(doc['summary']) || doc['tests'].some((t) => isObj(t) && typeof t['nodeid'] === 'string'))) return 'pytest-json-report';
  if (Array.isArray(doc['suites']) && isObj(doc['config']) && isObj(doc['stats'])) return 'playwright-json';
  return undefined;
}

function record(data: ResultIndexData, source: string, classname: string, name: string, status: TestStatus, reruns: number, file?: string, timeMs?: number): void {
  const rec: TestRecord = { key: normaliseKey(classname, name), classname, name, status, reruns, source };
  if (file !== undefined) rec.file = file;
  if (timeMs !== undefined && Number.isFinite(timeMs)) rec.timeMs = Math.round(timeMs);
  addRecord(data, rec);
}

/**
 * Jest and Vitest. Statuses: passed, failed; pending, skipped, todo and disabled read as skipped. A retried test:
 * Jest counts runs in `invocations` (2 when the second attempt passed); Vitest has no such field but keeps the
 * messages of the failed attempts in `failureMessages` of a test that finally passed.
 */
function readJestLike(doc: Json, source: string, data: ResultIndexData, label: string): number {
  let n = 0;
  for (const file of arr(doc['testResults'])) {
    if (!isObj(file)) continue;
    const path = str(file['name']) ?? str(file['testFilePath']) ?? '';
    const results = arr(file['assertionResults']);
    if (results.length === 0 && str(file['status']) === 'failed') {
      const msg = (str(file['message']) ?? str(file['failureMessage']) ?? '').trim().split('\n').find((l) => l.trim()) ?? '';
      data.warnings.push(`${source}: ${label} reports that ${path} failed to run${msg ? ` (${msg.trim().slice(0, 200)})` : ''}; none of its tests have a result`);
      continue;
    }
    for (const a of results) {
      if (!isObj(a)) continue;
      const title = str(a['title']) ?? '';
      const chain = [...arr(a['ancestorTitles']).filter((t): t is string => typeof t === 'string'), title].filter((t) => t !== '');
      const name = chain.length ? chain.join(' › ') : (str(a['fullName']) ?? '');
      const raw = str(a['status']) ?? '';
      const failedAttempts = arr(a['failureMessages']).length;
      const invocations = typeof a['invocations'] === 'number' ? a['invocations'] : undefined;
      let status: TestStatus;
      let reruns = 0;
      if (raw === 'passed' || raw === 'focused') {
        reruns = invocations !== undefined ? Math.max(0, invocations - 1) : failedAttempts;
        status = reruns > 0 ? 'flaky' : 'passed';
      } else if (raw === 'failed') {
        status = 'failed';
        reruns = invocations !== undefined ? Math.max(0, invocations - 1) : Math.max(0, failedAttempts - 1);
      } else if (raw === 'pending' || raw === 'skipped' || raw === 'todo' || raw === 'disabled') {
        status = 'skipped';
      } else {
        data.warnings.push(`${source}: unknown status ${JSON.stringify(raw).slice(0, 40)} for ${name.slice(0, 120)}; not read`);
        continue;
      }
      const duration = typeof a['duration'] === 'number' ? a['duration'] : undefined;
      record(data, source, path, name, status, reruns, path || undefined, duration);
      n++;
    }
  }
  return n;
}

/** Split a pytest node id into the junitxml classname and name: `tests/test_x.py::TestK::test_a[p]` → `tests.test_x.TestK`, `test_a[p]`. */
export function pytestNodeId(nodeid: string): { classname: string; name: string; file: string } | undefined {
  const bracket = nodeid.indexOf('[');
  const head = bracket >= 0 ? nodeid.slice(0, bracket) : nodeid;
  const param = bracket >= 0 ? nodeid.slice(bracket) : '';
  const parts = head.split('::');
  if (parts.length < 2 || !parts[parts.length - 1]) return undefined;
  const file = parts[0]!;
  const module = file.replace(/\\/g, '/').replace(/\.py$/, '').split('/').filter(Boolean).join('.');
  const classes = parts.slice(1, -1);
  return { classname: [module, ...classes].filter(Boolean).join('.'), name: parts[parts.length - 1]! + param, file };
}

/**
 * pytest-json-report. Outcomes: passed; failed; error (setup or teardown failed); skipped; xfailed reads as skipped
 * (an expected failure, as the junitxml plugin writes it); xpassed reads as passed. With pytest-rerunfailures the
 * outcome of a rerun test is `rerun` whatever its last attempt did, so the call phase decides: passed is flaky.
 */
function readPytestJson(doc: Json, source: string, data: ResultIndexData): number {
  let n = 0;
  let xfailed = 0;
  let reruns = 0;
  for (const c of arr(doc['collectors'])) {
    if (isObj(c) && str(c['outcome']) === 'failed') data.warnings.push(`${source}: pytest could not collect ${str(c['nodeid']) || 'the session'}; its tests have no result`);
  }
  for (const t of arr(doc['tests'])) {
    if (!isObj(t)) continue;
    const nodeid = str(t['nodeid']) ?? '';
    const id = pytestNodeId(nodeid);
    if (!id) {
      data.warnings.push(`${source}: node id ${JSON.stringify(nodeid).slice(0, 120)} has no test name; not read`);
      continue;
    }
    const outcome = str(t['outcome']) ?? '';
    const phase = (k: string) => (isObj(t[k]) ? str((t[k] as Json)['outcome']) : undefined);
    let status: TestStatus;
    let rr = 0;
    switch (outcome) {
      case 'passed':
      case 'xpassed':
        status = 'passed';
        break;
      case 'failed':
        status = 'failed';
        break;
      case 'error':
        status = 'error';
        break;
      case 'skipped':
        status = 'skipped';
        break;
      case 'xfailed':
        status = 'skipped';
        xfailed++;
        break;
      case 'rerun': {
        reruns++;
        rr = 1;
        const setup = phase('setup');
        const call = phase('call');
        const teardown = phase('teardown');
        if (setup === 'failed' || teardown === 'failed') status = 'error';
        else if (call === 'passed') status = 'flaky';
        else if (call === 'skipped' || setup === 'skipped') status = 'skipped';
        else status = 'failed';
        break;
      }
      default:
        data.warnings.push(`${source}: unknown outcome ${JSON.stringify(outcome).slice(0, 40)} for ${nodeid.slice(0, 120)}; not read`);
        continue;
    }
    const call = isObj(t['call']) ? (t['call'] as Json) : undefined;
    const duration = call && typeof call['duration'] === 'number' ? call['duration'] * 1000 : undefined;
    record(data, source, id.classname, id.name, status, rr, id.file, duration);
    n++;
  }
  if (xfailed) data.warnings.push(`${source}: ${xfailed} xfailed test${xfailed === 1 ? '' : 's'} read as skipped`);
  if (reruns) data.warnings.push(`${source}: ${reruns} test${reruns === 1 ? '' : 's'} with outcome rerun; the report does not say how many attempts, so each counts one rerun`);
  return n;
}

/**
 * Playwright. Suites nest: the top level suite is the spec file, the ones below are describe blocks. Each spec has
 * one test per project, and the same spec in several projects folds onto one key keeping the worst status (the
 * project is a parametrisation, as in the junit reporter, which puts it in the suite hostname). A test's `status`
 * is expected, unexpected, flaky or skipped; expected with expectedStatus skipped is a skip, and an expected failure
 * (`test.fail()`) is a pass. When `status` is absent the results decide: a later passed attempt after a failed one is
 * flaky. An interrupted last attempt is an error.
 */
function readPlaywrightJson(doc: Json, source: string, data: ResultIndexData): number {
  let n = 0;
  for (const e of arr(doc['errors'])) {
    const msg = isObj(e) ? (str(e['message']) ?? '') : '';
    if (msg) data.warnings.push(`${source}: Playwright reported an error outside any test (${msg.split('\n')[0]!.replace(ANSI, '').slice(0, 200)})`);
  }
  const walk = (suite: Json, titles: string[], depth: number, file: string) => {
    const here = depth === 0 ? [] : [...titles, str(suite['title']) ?? ''];
    const suiteFile = str(suite['file']) ?? file;
    for (const spec of arr(suite['specs'])) {
      if (!isObj(spec)) continue;
      const specFile = str(spec['file']) ?? suiteFile;
      const name = [...here, str(spec['title']) ?? ''].filter((t) => t !== '').join(' › ');
      for (const t of arr(spec['tests'])) {
        if (!isObj(t)) continue;
        const results = arr(t['results']).filter(isObj);
        const statuses = results.map((r) => str(r['status']) ?? '');
        const last = statuses[statuses.length - 1];
        const status = str(t['status']);
        let s: TestStatus;
        if (status === 'skipped' || (status === 'expected' && str(t['expectedStatus']) === 'skipped')) s = 'skipped';
        else if (status === 'expected') s = 'passed';
        else if (status === 'flaky') s = 'flaky';
        else if (status === 'unexpected') s = last === 'interrupted' ? 'error' : 'failed';
        else if (!statuses.length) s = 'skipped';
        else if (last === 'passed') s = statuses.some((x) => x !== 'passed' && x !== 'skipped') ? 'flaky' : 'passed';
        else if (last === 'skipped') s = 'skipped';
        else if (last === 'interrupted') s = 'error';
        else s = 'failed';
        const duration = results.reduce((sum, r) => sum + (typeof r['duration'] === 'number' ? r['duration'] : 0), 0);
        record(data, source, specFile, name, s, Math.max(0, results.length - 1), specFile, duration);
        n++;
      }
    }
    for (const child of arr(suite['suites'])) if (isObj(child)) walk(child, here, depth + 1, suiteFile);
  };
  for (const s of arr(doc['suites'])) if (isObj(s)) walk(s, [], 0, str(s['file']) ?? str(s['title']) ?? '');
  return n;
}

/** Read a parsed JSON results document into the index. Returns the format, or undefined when it is not one. */
export function readJsonResults(doc: unknown, source: string, data: ResultIndexData): ResultFormat | undefined {
  const format = detectJsonFormat(doc);
  if (!format) return undefined;
  const d = doc as Json;
  let n = 0;
  switch (format) {
    case 'jest-json':
      n = readJestLike(d, source, data, 'Jest');
      break;
    case 'vitest-json':
      n = readJestLike(d, source, data, 'Vitest');
      break;
    case 'pytest-json-report':
      n = readPytestJson(d, source, data);
      break;
    case 'playwright-json':
      n = readPlaywrightJson(d, source, data);
      break;
  }
  if (n === 0) data.warnings.push(`${source}: no test results found`);
  data.sources.push(source);
  data.formats.add(format);
  return format;
}
