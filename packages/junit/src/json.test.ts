import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inventoryKeys } from '@testwitness/core';
import { detectJsonFormat, pytestNodeId } from './json.js';
import { readResultsFiles, readResultsString, toEvidence } from './reader.js';

// Every sample below is real reporter output; each results/<format>/PRODUCER.md has the versions and commands.
const F = join(import.meta.dirname, '../../../fixtures');
const JEST = join(F, 'ts-jest/results/jest-json/results.json');
const JEST_RETRY = join(F, 'ts-jest/results/jest-json/results-retry.json');
const VITEST = join(F, 'ts-vitest/results/vitest-json/results.json');
const VITEST_RETRY = join(F, 'ts-vitest/results/vitest-json/results-retry.json');
const PYTEST = join(F, 'py-pytest/results/pytest-json-report/report.json');
const PYTEST_RERUN = join(F, 'py-pytest/results/pytest-json-report/report-reruns.json');
const PW = join(F, 'ts-playwright/results/playwright-json/results.json');
const PW_PROJECTS = join(F, 'ts-playwright/results/playwright-json/results-projects.json');

const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const statuses = async (p: string) => Object.fromEntries([...(await readResultsFiles([p])).records.values()].map((r) => [r.key, `${r.status}${r.reruns ? `+${r.reruns}` : ''}`]));
const keysOf = async (p: string) => [...(await readResultsFiles([p])).records.keys()].sort();

describe('detectJsonFormat', () => {
  it('tells the four reporters apart by shape', () => {
    expect(detectJsonFormat(json(JEST))).toBe('jest-json');
    expect(detectJsonFormat(json(JEST_RETRY))).toBe('jest-json');
    expect(detectJsonFormat(json(VITEST))).toBe('vitest-json');
    expect(detectJsonFormat(json(PYTEST))).toBe('pytest-json-report');
    expect(detectJsonFormat(json(PW))).toBe('playwright-json');
    expect(detectJsonFormat({ name: 'pkg', version: '1.0.0' })).toBeUndefined();
    expect(detectJsonFormat([1, 2])).toBeUndefined();
    expect(detectJsonFormat(null)).toBeUndefined();
  });
});

describe('Jest 30.5.2 --json', () => {
  it('reads every assertion result with the console summary counts (1 failed, 1 skipped, 1 todo, 6 passed)', async () => {
    const d = await readResultsFiles([JEST]);
    expect(d.totals).toEqual({ total: 9, passed: 6, failed: 1, errored: 0, skipped: 2, flaky: 0 });
    expect([...d.formats]).toEqual(['jest-json']);
    expect(d.warnings).toEqual([]);
    const s = await statuses(JEST);
    expect(s['billing::billing charge handles refunds']).toBe('skipped'); // status pending
    expect(s['billing::billing charge supports partial captures']).toBe('skipped'); // status todo
    expect(s['billing::billing charge fails on purpose']).toBe('failed');
  });

  it('keys tests as file stem :: ancestor titles and title, which the inventory produces', async () => {
    const e = toEvidence(await readResultsFiles([JEST]));
    expect(e.has('billing::billing charge adds 2 and 3 to get 5')).toBe(true);
    expect(inventoryKeys('src/billing.test.js', 'Billing › formatInvoice › matches the invoice snapshot', 'javascript')).toContain('billing::billing formatinvoice matches the invoice snapshot');
    expect(e.has('billing::billing formatinvoice matches the invoice snapshot')).toBe(true);
  });

  it('reads retries from invocations: passed on the second run is flaky', async () => {
    expect(await statuses(JEST_RETRY)).toEqual({ 'retry::retry passes on the second attempt': 'flaky+1', 'retry::retry always fails': 'failed+2' });
  });
});

describe('Vitest 5.0.5 --reporter=json', () => {
  it('reads the same shape as Jest, with skipped instead of pending and no invocations', async () => {
    const d = await readResultsFiles([VITEST]);
    expect(d.totals).toEqual({ total: 9, passed: 6, failed: 1, errored: 0, skipped: 2, flaky: 0 });
    expect([...d.formats]).toEqual(['vitest-json']);
  });

  it('gives the same keys as the Vitest junit reporter for the same project', async () => {
    const junit = [...(await readResultsFiles([join(F, 'ts-vitest/junit/junit.xml')])).records.keys()].sort();
    expect(await keysOf(VITEST)).toEqual(junit);
  });

  it('reads retries from the failure messages of a test that finally passed', async () => {
    expect(await statuses(VITEST_RETRY)).toEqual({ 'retry::retry passes on the second attempt': 'flaky+1', 'retry::retry always fails': 'failed+2' });
  });
});

describe('pytest-json-report 1.5.0', () => {
  it('maps the outcomes: xfailed to skipped with a note, xpassed to passed, error to error', async () => {
    const d = await readResultsFiles([PYTEST]);
    const s = await statuses(PYTEST);
    expect(s['test_inventory::test_xfail_that_fails']).toBe('skipped');
    expect(s['test_inventory::test_xfail_that_passes']).toBe('passed');
    expect(s['test_inventory::test_errors_in_fixture']).toBe('error');
    expect(s['test_inventory::test_fails_on_purpose']).toBe('failed');
    expect(s['test_inventory::test_transfer_between_warehouses']).toBe('skipped');
    expect(d.warnings.some((w) => /1 xfailed test read as skipped/.test(w))).toBe(true);
    // 13 tests, three parametrised rows folding onto one key as in the junitxml reader
    expect(d.totals).toEqual({ total: 11, passed: 6, failed: 1, errored: 1, skipped: 3, flaky: 0 });
  });

  it('gives the same keys as the pytest junitxml plugin for the same tests', async () => {
    const junit = [...(await readResultsFiles([join(F, 'py-pytest/junit/junit.xml')])).records.keys()].sort();
    expect(await keysOf(PYTEST)).toEqual(junit);
  });

  it('reads outcome rerun by its call phase: passed on the rerun is flaky', async () => {
    expect(await statuses(PYTEST_RERUN)).toEqual({ 'test_rerun::test_flaky_passes_on_rerun': 'flaky+1' });
  });

  it('splits node ids like the junitxml classname and name', () => {
    expect(pytestNodeId('tests/test_inventory.py::test_add_parametrized[\\xfcn\\xefcode[brackets]]')).toEqual({ classname: 'tests.test_inventory', name: 'test_add_parametrized[\\xfcn\\xefcode[brackets]]', file: 'tests/test_inventory.py' });
    expect(pytestNodeId('tests/test_inventory.py::TestInventoryClass::test_rejects_non_positive')?.classname).toBe('tests.test_inventory.TestInventoryClass');
    expect(pytestNodeId('t.py::test_a[x::y]')).toEqual({ classname: 't', name: 'test_a[x::y]', file: 't.py' });
    expect(pytestNodeId('tests/test_inventory.py')).toBeUndefined();
  });
});

describe('Playwright 1.63.0 --reporter=json', () => {
  it('reads the test status: expected failure passes, fixme and skip are skipped, a retry that passed is flaky', async () => {
    const d = await readResultsFiles([PW]);
    expect(d.totals).toEqual({ total: 9, passed: 6, failed: 1, errored: 0, skipped: 2, flaky: 1 });
    const s = await statuses(PW);
    expect(s['unit::expected to fail']).toBe('passed');
    expect(s['unit::pricing handles negative amounts']).toBe('skipped');
    expect(s['unit::pricing flaky passes on retry']).toBe('flaky+1');
    expect(s['unit::pricing fails on purpose']).toBe('failed+1');
  });

  it('gives the same keys as the Playwright junit reporter for the same project', async () => {
    const junit = [...(await readResultsFiles([join(F, 'ts-playwright/junit/junit.xml')])).records.keys()].sort();
    expect(await keysOf(PW)).toEqual(junit);
  });

  it('folds one spec run in two projects onto one key, keeping the worst status', async () => {
    const d = await readResultsFiles([PW_PROJECTS]);
    // flaky in the first project, passed on its first attempt in the second
    expect(d.records.get('unit::pricing flaky passes on retry')?.status).toBe('flaky');
    expect(d.records.get('unit::pricing fails on purpose')?.reruns).toBe(2);
    expect(d.totals.total).toBe(7);
  });

  it('derives the status from the results when a test has no status field', async () => {
    const d = await readResultsString(
      JSON.stringify({ config: {}, stats: {}, suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 't', file: 'a.spec.ts', tests: [{ projectName: 'p', results: [{ status: 'timedOut' }, { status: 'passed' }] }, { projectName: 'q', results: [{ status: 'interrupted' }] }] }] }] }),
    );
    expect(d.records.get('a::t')?.status).toBe('error');
  });
});

describe('JSON robustness', () => {
  it('notes a JSON file of another kind and a Jest file that failed to run, never throwing', async () => {
    const other = await readResultsString('{"name":"pkg"}', 'package.json');
    expect(other.sources).toEqual([]);
    expect(other.warnings[0]).toMatch(/not JUnit XML, TAP, or the JSON output/);
    const broken = await readResultsString('{"testResults": [', 'broken.json');
    expect(broken.warnings[0]).toMatch(/not valid JSON/);
    const failedSuite = await readResultsString(JSON.stringify({ numRuntimeErrorTestSuites: 1, testResults: [{ name: '/r/src/a.test.js', status: 'failed', message: '\n  ● Test suite failed to run\n', assertionResults: [] }] }), 'jest.json');
    expect(failedSuite.warnings.some((w) => /a\.test\.js failed to run \(● Test suite failed to run\)/.test(w))).toBe(true);
    expect(failedSuite.sources).toEqual(['jest.json']);
  });

  it('skips records of unknown shape and unknown statuses with a warning', async () => {
    const d = await readResultsString(JSON.stringify({ openHandles: [], testResults: [{ name: 'x.test.js', assertionResults: [null, 3, { title: 'a', ancestorTitles: ['A'], status: 'weird' }, { title: 'b', ancestorTitles: [], status: 'passed' }] }] }));
    expect([...d.records.keys()]).toEqual(['x::b']);
    expect(d.warnings.some((w) => /unknown status "weird"/.test(w))).toBe(true);
  });
});
