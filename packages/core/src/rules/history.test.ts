import { describe, expect, it } from 'vitest';
import type { Finding } from '../types.js';
import { emptyHistory, type HistoryDocument } from '../history/history.js';
import { applyHistory } from './history.js';
import { R001, R003, R004 } from './R.js';
import { V003 } from './V.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

const P = 'src/cart.test.ts';
/** inventoryKeys for `cart › <name>` in src/cart.test.ts includes `cart::<name>`. */
const key = (name: string) => `cart::${name}`;

function history(tests: Record<string, string>, runs = Math.max(...Object.values(tests).map((s) => s.length))): HistoryDocument {
  return {
    ...emptyHistory(),
    runs: Array.from({ length: runs }, (_, i) => ({ id: `r${i}`, date: '2026-11-04', total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0 })),
    tests,
  };
}

const skip = (reason?: string) => [{ marker: 'it.skip', kind: 'skip' as const, constant: true, ...(reason ? { reason } : {}) }];

async function r003(reason?: string): Promise<{ findings: Finding[]; files: ReturnType<typeof context>['files'] }> {
  const base = t({ name: 'totals', container: ['cart'], body: 'x' });
  const head = t({ name: 'totals', container: ['cart'], body: 'x', markers: skip(reason) });
  const pair = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) };
  const ctx = context({ pairs: [pair] });
  return { findings: await R003.run(ctx, {}), files: ctx.files };
}

describe('history: skip, delete or xfail hides a failure', () => {
  it('raises R003 to high with the label hides failure when the test failed in 3 of its last 5 recorded runs', async () => {
    const { findings, files } = await r003();
    expect(findings[0]).toMatchObject({ severity: 'medium' });
    const n = applyHistory(findings, history({ [key('totals')]: 'PPPPF-PFFP' }), files);
    expect(n).toBe(1);
    expect(findings[0]).toMatchObject({ severity: 'high', label: 'hides failure' });
    expect(findings[0]!.message).toMatch(/; failed in 3 of the last 5 runs$/);
  });

  it('counts errors as failures and needs at least 2', async () => {
    const a = await r003();
    applyHistory(a.findings, history({ [key('totals')]: 'PPPPE' }), a.files);
    expect(a.findings[0]).toMatchObject({ severity: 'medium' });
    expect(a.findings[0]!.label).toBeUndefined();
    const b = await r003();
    applyHistory(b.findings, history({ [key('totals')]: 'PEPfP' }), b.files);
    expect(b.findings[0]).toMatchObject({ severity: 'high', label: 'hides failure' });
  });

  it('raises a tracked skip of a failing test too: the issue does not make the test pass', async () => {
    const { findings, files } = await r003('see #412');
    expect(findings[0]).toMatchObject({ severity: 'low', label: 'tracked' });
    applyHistory(findings, history({ [key('totals')]: 'FFFFF' }), files);
    expect(findings[0]).toMatchObject({ severity: 'high', label: 'hides failure' });
  });

  it('raises R001 and R004, and leaves a deletion the rule found moved alone', async () => {
    const base = t({ name: 'totals', container: ['cart'], body: 'x' });
    const other = t({ name: 'other', container: ['cart'], body: 'o' });
    const del = { file: changedFile(P), base: inventory(P, [base, other]), head: inventory(P, [other]) };
    const ctx = context({ pairs: [del] });
    const deleted = await R001.run(ctx, {});
    expect(deleted[0]).toMatchObject({ severity: 'medium' });
    applyHistory(deleted, history({ [key('totals')]: 'FFPPP' }), ctx.files);
    expect(deleted[0]).toMatchObject({ severity: 'high', label: 'hides failure' });

    const moved = await R001.run(context({ pairs: [del], headTree: { 'src/other.test.ts': inventory('src/other.test.ts', [t({ name: 'totals', body: 'x' })]) } }), {});
    expect(moved[0]).toMatchObject({ severity: 'low', label: 'moved' });
    applyHistory(moved, history({ [key('totals')]: 'FFFFF' }), ctx.files);
    expect(moved[0]).toMatchObject({ severity: 'low', label: 'moved' });

    const xfail = { file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [t({ name: 'totals', container: ['cart'], body: 'x', markers: [{ marker: 'test.fails', kind: 'xfail', constant: true, reason: 'see #9' }] })]) };
    const xctx = context({ pairs: [xfail] });
    const xf = await R004.run(xctx, {});
    applyHistory(xf, history({ [key('totals')]: 'PFFPP' }), xctx.files);
    expect(xf[0]).toMatchObject({ severity: 'high', label: 'hides failure' });
  });
});

describe('history: skip of a flaky test with an issue', () => {
  it('keeps the severity and labels it flaky in history when the test passed and failed in the window', async () => {
    const { findings, files } = await r003('flaky, tracked in #77');
    applyHistory(findings, history({ [key('totals')]: 'PPPPPPPPFPPPPP' }), files);
    expect(findings[0]).toMatchObject({ severity: 'low', label: 'flaky in history' });
    expect(findings[0]!.message).toMatch(/flaky in history: passed in 13 and failed in 1 of the last 14 runs, reran in 0$/);
  });

  it('labels it flaky in history when the test reran in at least 2 runs', async () => {
    const { findings, files } = await r003('flaky, tracked in #77');
    applyHistory(findings, history({ [key('totals')]: 'PKPPK' }), files);
    expect(findings[0]).toMatchObject({ severity: 'low', label: 'flaky in history' });
  });

  it('changes nothing without an issue reference, or when the test was never flaky', async () => {
    const a = await r003('flaky on CI');
    const before = { ...a.findings[0]! };
    expect(applyHistory(a.findings, history({ [key('totals')]: 'PKPPKPFP' }), a.files)).toBe(0);
    expect(a.findings[0]).toEqual(before);
    const b = await r003('see #77');
    applyHistory(b.findings, history({ [key('totals')]: 'PPPPPPP' }), b.files);
    expect(b.findings[0]).toMatchObject({ severity: 'low', label: 'tracked' });
  });

  it('changes nothing for a test that always passed', async () => {
    const { findings, files } = await r003();
    expect(applyHistory(findings, history({ [key('totals')]: 'PPPPPPPPPP' }), files)).toBe(0);
    expect(findings[0]).toMatchObject({ severity: 'medium' });
    expect(findings[0]!.label).toBeUndefined();
  });
});

describe('history: changed test did not run', () => {
  const ev = (keys: string[]) => {
    const set = new Set(keys);
    return { sources: ['junit.xml'], total: keys.length, passed: keys.length, failed: 0, errored: 0, skipped: 0, flaky: 0, has: (k: string) => set.has(k), statusOf: (k: string) => (set.has(k) ? ('passed' as const) : undefined), keysForClass: () => [], keys: () => set.keys() };
  };
  async function v003(): Promise<{ findings: Finding[]; files: ReturnType<typeof context>['files'] }> {
    const head = t({ name: 'totals', container: ['cart'], body: 'y' });
    const other = t({ name: 'other', container: ['cart'], body: 'o' });
    const pair = { file: changedFile(P), base: inventory(P, [t({ name: 'totals', container: ['cart'], body: 'x' }), other]), head: inventory(P, [head, other]) };
    const ctx = context({ pairs: [pair], evidence: ev(['cart other::cart other']) });
    return { findings: await V003.run(ctx, {}), files: ctx.files };
  }

  it('raises to high with the label ran before, not now when the test is in every one of the last 5 runs', async () => {
    const { findings, files } = await v003();
    applyHistory(findings, history({ [key('totals')]: '--SPPPP' }), files);
    expect(findings[0]).toMatchObject({ severity: 'high', label: 'ran before, not now' });
    expect(findings[0]!.message).toMatch(/it ran in each of the last 5 runs$/);
  });

  it('stays as is when the history never saw the test, saw it with a gap, or has fewer than 5 runs', async () => {
    for (const tests of [{ 'cart::elsewhere': 'PPPPP' }, { [key('totals')]: 'PPP-P' }, { [key('totals')]: 'PPPP' }]) {
      const { findings, files } = await v003();
      const before = { ...findings[0]! };
      expect(applyHistory(findings, history(tests), files)).toBe(0);
      expect(findings[0]).toEqual(before);
    }
  });

  it('leaves partial results alone', async () => {
    const { findings, files } = await v003();
    findings[0]!.severity = 'low';
    findings[0]!.label = 'partial results';
    expect(applyHistory(findings, history({ [key('totals')]: 'PPPPP' }), files)).toBe(0);
  });
});

