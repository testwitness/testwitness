// The proof of the agent guard on the corpus, in one pass over all 134 pull requests:
//
//   Criterion 1   `check --worktree` gives the same findings, with the same fingerprints, as the commit to commit check
//                 gives once the change is committed, and it leaves the repository untouched. Every entry is replayed,
//                 so every entry with a medium or high finding is.
//   Criterion 12  each true positive pull request is applied as a working tree change and the hook runs on it; the
//                 share blocked per rule is the table in docs/precision.md, which this test recomputes.
//   Criterion 13  the false positive findings are replayed the same way, and the judged findings of the 300 pull
//                 request trial (corpus/trial/hook-trial-2026-11.json) are graded the same way; the hook's blocking
//                 list must be exactly the rules both sets qualify, and at the default no block is wrongful.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_BLOCKING, HOOK_BLOCKING_UNMEASURED } from '@testwitness/core';
import { loadCorpus } from './corpus.js';
import { HOOK_REPLAY_HEADING, hookStats, loadTrial, qualifyingRules, renderHookReplayMarkdown, replayWithHook, type EntryReplay, type HookStats } from './hook-replay.js';
import { findingKey, pool } from './replay.js';
import { installNetworkGuard } from '../../packages/cli/src/testing/no-network.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = loadCorpus(root);
const results = new Map<string, EntryReplay>();
let stats: HookStats;

// The whole replay runs with the network guard installed: a socket, a DNS lookup or a fetch would fail it.
const network = installNetworkGuard();
afterAll(() => {
  expect(network.attempts()).toEqual([]);
  network.restore();
});

beforeAll(async () => {
  const all = await pool(entries, 4, replayWithHook);
  entries.forEach((e, i) => results.set(e.slug, all[i]!));
  stats = hookStats(all);
}, 900_000);

describe('criterion 1: the working tree check equals the commit check', () => {
  it('covers the whole corpus, and most entries have a medium or high finding', () => {
    expect(entries.length).toBeGreaterThanOrEqual(134);
    const withFinding = entries.filter((e) => results.get(e.slug)!.replay.commit.findings.some((f) => f.severity !== 'low'));
    expect(withFinding.length).toBeGreaterThanOrEqual(80);
  });

  for (const e of entries) {
    it(`${e.slug}: same findings and fingerprints, repository untouched`, () => {
      const r = results.get(e.slug)!.replay;
      expect(r.worktree.findings.map(findingKey)).toEqual(r.commit.findings.map(findingKey));
      expect(r.worktree.findings.map((f) => f.fingerprint)).toEqual(r.commit.findings.map((f) => f.fingerprint));
      expect(r.worktree.state).toBe(r.commit.state);
      expect(r.worktree.summary).toEqual(r.commit.summary);
      expect(r.worktree.files).toEqual(r.commit.files);
      expect(r.worktree.headTree).toMatch(/^[0-9a-f]{40,64}$/);
      expect(r.commit.headTree).toBeUndefined();
      expect(r.untouched).toBe(true);
    });
  }
});

describe('criteria 12 and 13: the hook on the corpus as working tree changes', () => {
  for (const e of entries) {
    it(`${e.slug}: the hook blocks exactly on the open high findings of the blocking list`, () => {
      const r = results.get(e.slug)!;
      const expected = r.replay.commit.findings.filter((f) => f.severity === 'high' && !f.acknowledged && HOOK_BLOCKING.includes(f.ruleId)).map((f) => f.fingerprint);
      expect([...r.hook.blocking].sort()).toEqual([...expected].sort());
      expect([...r.hook.atDefault].sort()).toEqual([...expected].sort());
      expect(r.hook.blocked).toBe(expected.length > 0);
      if (r.hook.blocked) {
        const out = JSON.parse(r.hook.stdout) as { decision: string; reason: string };
        expect(out.decision).toBe('block');
        expect(out.reason).toContain('Restore the base text, or keep the change and state why in the PR description');
      }
    });
  }

  it('every true positive at high severity of a blocking rule is blocked', () => {
    for (const row of stats.rows.filter((r) => r.blocks)) expect(row.tpBlocked, row.ruleId).toBe(row.tpHigh);
    for (const row of stats.rows.filter((r) => !r.blocks)) expect(row.tpBlocked, row.ruleId).toBe(0);
    expect(stats.tpEntries).toBeGreaterThan(50);
    expect(stats.tpEntriesBlocked).toBeGreaterThan(0);
  });

  it('the blocking list is exactly the rules both measurements qualify (plus W006), and no block is wrongful at the default', () => {
    const trial = loadTrial();
    const qualified = qualifyingRules(stats);
    const listed = HOOK_BLOCKING.filter((id) => !HOOK_BLOCKING_UNMEASURED.includes(id)).sort();
    // A listed rule that gained a wrongful block (or lost its true positives) must come off the list.
    const noLongerQualify = listed.filter((id) => !qualified.includes(id));
    // A rule that now qualifies is printed, and the list is widened by hand in packages/core/src/config.ts.
    const nowQualify = qualified.filter((id) => !listed.includes(id));
    const report = `qualify today: ${qualified.join(', ') || 'none'}; on HOOK_BLOCKING but no longer qualifying: ${noLongerQualify.join(', ') || 'none'}; qualifying but not on HOOK_BLOCKING: ${nowQualify.join(', ') || 'none'}`;
    console.log(`agent hook blocking list: ${report}`);
    expect(noLongerQualify, report).toEqual([]);
    expect(nowQualify, report).toEqual([]);
    expect([...HOOK_BLOCKING_UNMEASURED]).toEqual(['W006']);
    for (const row of stats.rows) {
      expect(row.wrongfulAtDefault, row.ruleId).toBe(0);
      if (row.blocks) {
        expect(row.wrongfulEveryHigh, row.ruleId).toBe(0);
        expect(row.trialHighFp, row.ruleId).toBe(0);
      }
    }
    expect(stats.honestEntriesBlocked).toBe(0);
    expect(trial.pullRequests).toBe(300);
    expect(trial.pullRequestsAtDefault.blockedWrongly).toBe(0);
    // The trial file carries counts only: no repository or pull request is named in it.
    expect(JSON.stringify(trial)).not.toMatch(/github\.com|[a-z0-9-]+\/[a-z0-9-]+#\d+/i);
  });

  it('docs/precision.md publishes these numbers', () => {
    const doc = readFileSync(join(root, '..', 'docs', 'precision.md'), 'utf8');
    const at = doc.indexOf(HOOK_REPLAY_HEADING);
    expect(at, 'docs/precision.md has no "Agent hook replay" section; run pnpm corpus:report').toBeGreaterThan(0);
    const published = doc.slice(at);
    const date = /Measured (\d{4}-\d{2}-\d{2})/.exec(published)?.[1] ?? '';
    expect(published).toBe(renderHookReplayMarkdown(stats, date));
  });
});
