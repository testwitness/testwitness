import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TestStatus } from '../types.js';
import {
  emptyHistory,
  HISTORY_WINDOW,
  lookupHistory,
  mergeHistory,
  outcomeOf,
  parseHistory,
  serializeHistory,
  statsFor,
  type HistoryDocument,
  type HistoryResult,
} from './history.js';

const r = (key: string, status: TestStatus, reruns = 0): HistoryResult => ({ key, status, reruns });

/** Merge runs in order, ids run-1, run-2, ... */
function build(runs: HistoryResult[][], opts: { window?: number; maxBytes?: number } = {}): HistoryDocument {
  let doc: HistoryDocument | undefined;
  runs.forEach((results, i) => {
    doc = mergeHistory(doc, { id: `run-${i + 1}`, date: '2026-11-04' }, results, opts);
  });
  return doc ?? emptyHistory();
}

describe('history merge', () => {
  it('appends one aligned column per run and pads keys first seen later', () => {
    const doc = build([[r('a::x', 'passed')], [r('a::x', 'failed'), r('a::y', 'passed')], [r('a::y', 'skipped')]]);
    expect(doc.runs.map((x) => x.id)).toEqual(['run-1', 'run-2', 'run-3']);
    expect(doc.tests).toEqual({ 'a::x': 'PF-', 'a::y': '-PS' });
    expect(doc.runs[1]).toMatchObject({ total: 2, passed: 1, failed: 1 });
  });

  it('encodes reruns: flaky as K, failed or errored after reruns as f and e', () => {
    expect([outcomeOf('flaky', 1), outcomeOf('passed', 1), outcomeOf('failed', 2), outcomeOf('error', 1), outcomeOf('failed', 0), outcomeOf('error', 0), outcomeOf('skipped', 0), outcomeOf('passed', 0)]).toEqual(['K', 'K', 'f', 'e', 'F', 'E', 'S', 'P']);
  });

  it('keeps the worst outcome when a key repeats within a run', () => {
    const doc = build([[r('a::x', 'passed'), r('a::x', 'error'), r('a::x', 'failed')]]);
    expect(doc.tests['a::x']).toBe('E');
    expect(doc.runs[0]!.total).toBe(1);
  });

  it('replaces the column of a run id that is already present', () => {
    const first = build([[r('a::x', 'passed')], [r('a::x', 'failed'), r('a::gone', 'passed')]]);
    const again = mergeHistory(first, { id: 'run-2', date: '2026-11-05' }, [r('a::x', 'passed')]);
    expect(again.runs.map((x) => x.id)).toEqual(['run-1', 'run-2']);
    expect(again.runs[1]!.date).toBe('2026-11-05');
    expect(again.tests).toEqual({ 'a::x': 'PP' });
  });

  it('rolls off the oldest run past the window of 20 and drops keys with no record left', () => {
    const runs: HistoryResult[][] = [[r('old::only', 'passed'), r('a::x', 'failed')]];
    for (let i = 0; i < HISTORY_WINDOW; i++) runs.push([r('a::x', 'passed')]);
    const doc = build(runs);
    expect(doc.runs).toHaveLength(HISTORY_WINDOW);
    expect(doc.runs[0]!.id).toBe('run-2');
    expect(doc.tests['old::only']).toBeUndefined();
    expect(doc.tests['a::x']).toBe('P'.repeat(HISTORY_WINDOW));
  });

  it('does not modify the document it was given', () => {
    const prev = build([[r('a::x', 'passed')]]);
    const copy = JSON.parse(JSON.stringify(prev));
    mergeHistory(prev, { id: 'n', date: '2026-11-04' }, [r('a::x', 'failed')]);
    expect(prev).toEqual(copy);
  });

  it('rolls off the oldest runs until the size cap is met, never the newest', () => {
    const many = (tag: string) => Array.from({ length: 200 }, (_, i) => r(`${tag}::test number ${i}`, 'passed'));
    const runs = [many('a'), many('b'), many('c'), many('d')];
    const uncapped = build(runs);
    const cap = Buffer.byteLength(serializeHistory(build(runs.slice(2)))) + 10;
    const doc = build(runs, { maxBytes: cap });
    expect(uncapped.runs).toHaveLength(4);
    expect(doc.runs.map((x) => x.id)).toEqual(['run-3', 'run-4']);
    expect(Buffer.byteLength(serializeHistory(doc))).toBeLessThanOrEqual(cap);
    expect(Object.keys(doc.tests).some((k) => k.startsWith('a::'))).toBe(false);
    expect(doc.truncated).toBeUndefined();
  });

  it('truncates the keys of a single run that alone exceeds the cap and says so', () => {
    const results = Array.from({ length: 500 }, (_, i) => r(`a::test ${String(i).padStart(3, '0')}`, 'passed'));
    const doc = mergeHistory(undefined, { id: 'big', date: '2026-11-04' }, results, { maxBytes: 4000 });
    expect(doc.truncated).toBe(true);
    expect(doc.runs).toHaveLength(1);
    expect(Buffer.byteLength(serializeHistory(doc))).toBeLessThanOrEqual(4000);
    expect(Object.keys(doc.tests).length).toBeGreaterThan(10);
    expect(Object.keys(doc.tests).length).toBeLessThan(500);
  });
});

describe('history stats', () => {
  const doc: HistoryDocument = {
    ...emptyHistory(),
    runs: Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, date: '2026-11-04', total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 })),
    tests: {
      'a::failing': 'PPFPF-E',
      'a::once': 'FFFPPPP',
      'a::flaky': 'PPPPPPF',
      'a::reruns': 'PKPPKPP',
      'a::onerun': 'PPPPKPP',
      'a::gap': 'PPPP-PP',
      'a::steady': 'PPPPPPP',
      'a::skipped': 'SSSSSSS',
    },
  };
  it('counts failures in the last 5 recorded runs of the test, not the last 5 runs of the document', () => {
    expect(statsFor(doc, 'a::failing')).toMatchObject({ seen: 6, recentRuns: 5, recentFailed: 3 });
    expect(statsFor(doc, 'a::once')).toMatchObject({ recentFailed: 1 });
  });
  it('is flaky when it passed and failed in the window, or reran in at least 2 runs', () => {
    expect(statsFor(doc, 'a::flaky')!.flaky).toBe(true);
    expect(statsFor(doc, 'a::reruns')).toMatchObject({ flaky: true, rerunRuns: 2, failed: 0 });
    expect(statsFor(doc, 'a::onerun')!.flaky).toBe(false);
    expect(statsFor(doc, 'a::steady')!.flaky).toBe(false);
  });
  it('is seen in every recent run only without a gap in the last 5 runs', () => {
    expect(statsFor(doc, 'a::steady')!.seenInEveryRecentRun).toBe(true);
    expect(statsFor(doc, 'a::skipped')!.seenInEveryRecentRun).toBe(true);
    expect(statsFor(doc, 'a::gap')!.seenInEveryRecentRun).toBe(false);
    expect(statsFor(doc, 'a::failing')!.seenInEveryRecentRun).toBe(false);
    const short = build([[r('a::x', 'passed')], [r('a::x', 'passed')], [r('a::x', 'passed')], [r('a::x', 'passed')]]);
    expect(statsFor(short, 'a::x')!.seenInEveryRecentRun).toBe(false);
  });
  it('looks up the first candidate key the history knows', () => {
    expect(lookupHistory(doc, ['nope::x', 'a::steady', 'a::flaky'])?.key).toBe('a::steady');
    expect(lookupHistory(doc, ['nope::x'])).toBeUndefined();
  });
});

describe('history document', () => {
  it('round trips through serialize and parse, byte for byte', () => {
    const doc = build([[r('b::y', 'failed', 1), r('a::x', 'passed')], [r('a::x', 'flaky', 1)]]);
    const text = serializeHistory(doc);
    const parsed = parseHistory(text);
    expect(parsed.doc).toEqual(doc);
    expect(serializeHistory(parsed.doc!)).toBe(text);
    expect(parseHistory(serializeHistory(emptyHistory())).doc).toEqual(emptyHistory());
  });
  it('rejects other versions, misaligned entries and unknown outcome characters', () => {
    const ok = JSON.parse(serializeHistory(build([[r('a::x', 'passed')]])));
    expect(parseHistory('not json').error).toMatch(/not JSON/);
    expect(parseHistory(JSON.stringify({ ...ok, schemaVersion: '2' })).error).toMatch(/schemaVersion/);
    expect(parseHistory(JSON.stringify({ ...ok, tests: { 'a::x': 'PP' } })).error).toMatch(/one outcome per run/);
    expect(parseHistory(JSON.stringify({ ...ok, tests: { 'a::x': 'X' } })).error).toMatch(/one outcome per run/);
    expect(parseHistory(JSON.stringify({ ...ok, runs: [{ id: 'x', date: 'd', total: -1 }] })).error).toBeDefined();
  });
});

describe('history window properties', () => {
  const status = fc.constantFrom<TestStatus>('passed', 'failed', 'error', 'skipped', 'flaky');
  const run = fc.array(fc.record({ key: fc.constantFrom('a::x', 'a::y', 'b::z', 'c::w', 'd::v'), status, reruns: fc.nat(2) }), { maxLength: 6 });
  const runs = fc.array(fc.tuple(fc.constantFrom('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'), run), { minLength: 1, maxLength: 40 });

  it('never holds more than N runs, keeps every entry aligned, and never loses the newest run', () => {
    fc.assert(
      fc.property(runs, fc.integer({ min: 1, max: 25 }), (seq, window) => {
        let doc: HistoryDocument | undefined;
        for (const [id, results] of seq) {
          doc = mergeHistory(doc, { id, date: '2026-11-04' }, results, { window });
          expect(doc.runs.length).toBeLessThanOrEqual(window);
          expect(doc.runs[doc.runs.length - 1]!.id).toBe(id);
          expect(new Set(doc.runs.map((x) => x.id)).size).toBe(doc.runs.length);
          for (const s of Object.values(doc.tests)) {
            expect(s).toHaveLength(doc.runs.length);
            expect(/^-*$/.test(s)).toBe(false);
          }
          // The newest column is exactly this run's results.
          const worst = new Map<string, string>();
          const order = '-PKSFfEe';
          for (const x of results) {
            const o = outcomeOf(x.status, x.reruns);
            const had = worst.get(x.key);
            if (!had || order.indexOf(o) > order.indexOf(had)) worst.set(x.key, o);
          }
          for (const [k, s] of Object.entries(doc.tests)) expect(s[s.length - 1]).toBe(worst.get(k) ?? '-');
          for (const k of worst.keys()) expect(doc.tests[k]).toBeDefined();
        }
      }),
      { numRuns: 300 },
    );
  });

  it('never exceeds the size cap and never drops the newest run under it', () => {
    fc.assert(
      fc.property(runs, fc.integer({ min: 400, max: 3000 }), (seq, maxBytes) => {
        let doc: HistoryDocument | undefined;
        for (const [id, results] of seq) {
          doc = mergeHistory(doc, { id, date: '2026-11-04' }, results, { maxBytes });
          expect(Buffer.byteLength(serializeHistory(doc))).toBeLessThanOrEqual(maxBytes);
          expect(doc.runs[doc.runs.length - 1]!.id).toBe(id);
        }
      }),
      { numRuns: 200 },
    );
  });
});
