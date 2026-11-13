/**
 * Agent hook replay (acceptance criteria 12 and 13 of the agent guard): every corpus entry is applied as a working
 * tree change, the Claude Code Stop hook runs on it, and each finding the hook blocks on is matched with its hand
 * label. Counted per rule: how many true positives the hook blocks, and how many blocks are wrongful.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, runHook } from 'testwitness';
import { HOOK_ADVICE_ONLY } from '@testwitness/core';
import { judgeFindings, type CorpusEntry, type Judged } from './corpus.js';
import { replayEntry, type ReplayResult } from './replay.js';

const STOP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/hooks/claude/stop.json'), 'utf8');

export interface EntryReplay {
  slug: string;
  replay: ReplayResult;
  /** Verdicts of the commit check's findings (the labels of docs/precision.md). */
  judged: Judged[];
  hook: {
    /** The real hook's decision on the Stop event, loop guard fresh. */
    blocked: boolean;
    /** Fingerprints the real hook blocked on. */
    blocking: string[];
    /** Fingerprints the hook's grading blocks on at the default setting (same engine result, no loop guard). */
    atDefault: string[];
    /** The same with no rule advice only: every open high finding blocks. */
    everyHigh: string[];
    /** The same grading with `fail_on: medium` in the base config (advice only list unchanged). */
    atMedium: string[];
    /** The hook's stdout, as Claude Code receives it. */
    stdout: string;
  };
}

export async function replayWithHook(e: CorpusEntry): Promise<EntryReplay> {
  const replay = await replayEntry(e, async (repo, wt) => {
    const stateDir = mkdtempSync(join(tmpdir(), 'tw-replay-state-'));
    try {
      const r = await runHook({ agent: 'claude', input: STOP.replaceAll('__REPO__', repo).replace('"abc123"', JSON.stringify(`replay-${e.slug}`)), stateDir, base: 'main' });
      return {
        blocked: r.decision.block,
        blocking: (r.evaluation?.blocking ?? []).map((f) => f.fingerprint),
        atDefault: evaluate(wt, wt.config).blocking.map((f) => f.fingerprint),
        everyHigh: evaluate(wt, wt.config, []).blocking.map((f) => f.fingerprint),
        // V004 reads the pull request text, which the hook never has, so it cannot block there.
        atMedium: evaluate(wt, { ...wt.config, failOn: 'medium' }).blocking.filter((f) => f.ruleId !== 'V004').map((f) => f.fingerprint),
        stdout: r.stdout,
        note: r.decision.note,
      };
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
  return { slug: e.slug, replay, judged: judgeFindings(e, replay.commit.findings), hook: replay.extra as EntryReplay['hook'] };
}

export interface HookRuleRow {
  ruleId: string;
  /** True positive findings of the rule in the corpus, any severity. */
  tp: number;
  /** Of them, at high severity (the only ones the default setting can block on). */
  tpHigh: number;
  /** True positives the hook blocks on at the default setting. */
  tpBlocked: number;
  /** Findings that are not true positives which would block if every high finding blocked. */
  wrongfulEveryHigh: number;
  /** Wrongful blocks at the default setting, after the advice only list. */
  wrongfulAtDefault: number;
  /** True positives blocked, and wrongful blocks, when the base config sets `fail_on: medium`. */
  tpBlockedMedium: number;
  wrongfulAtMedium: number;
  adviceOnly: boolean;
}

export interface HookStats {
  entries: number;
  rows: HookRuleRow[];
  /** Entries with at least one true positive finding. */
  tpEntries: number;
  /** Of them, entries the hook blocks at the default setting. */
  tpEntriesBlocked: number;
  /** Of them, entries with a true positive at high severity. */
  tpEntriesHigh: number;
  /** Entries without any true positive finding. */
  honestEntries: number;
  /** Of them, entries the hook blocks at the default setting. */
  honestEntriesBlocked: number;
  /** Honest entries that would be blocked if every high finding blocked. */
  honestEntriesBlockedEveryHigh: number;
  /** With `fail_on: medium`: true positive entries blocked, and honest entries blocked. */
  tpEntriesBlockedMedium: number;
  honestEntriesBlockedMedium: number;
}

export function hookStats(all: EntryReplay[]): HookStats {
  const rows = new Map<string, HookRuleRow>();
  const row = (id: string): HookRuleRow => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { ruleId: id, tp: 0, tpHigh: 0, tpBlocked: 0, wrongfulEveryHigh: 0, wrongfulAtDefault: 0, tpBlockedMedium: 0, wrongfulAtMedium: 0, adviceOnly: HOOK_ADVICE_ONLY.includes(id) }));
    return r;
  };
  const stats: HookStats = { entries: all.length, rows: [], tpEntries: 0, tpEntriesBlocked: 0, tpEntriesHigh: 0, honestEntries: 0, honestEntriesBlocked: 0, honestEntriesBlockedEveryHigh: 0, tpEntriesBlockedMedium: 0, honestEntriesBlockedMedium: 0 };
  for (const e of all) {
    const atDefault = new Set(e.hook.atDefault);
    const everyHigh = new Set(e.hook.everyHigh);
    const atMedium = new Set(e.hook.atMedium);
    let tps = 0;
    let tpHigh = 0;
    for (const j of e.judged) {
      if (!j.finding) continue;
      const fp = j.finding.fingerprint;
      if (j.verdict.verdict === 'tp') {
        tps++;
        const r = row(j.finding.ruleId);
        r.tp++;
        if (j.finding.severity === 'high') (r.tpHigh++, tpHigh++);
        if (atDefault.has(fp)) r.tpBlocked++;
        if (atMedium.has(fp)) r.tpBlockedMedium++;
      } else {
        if (atMedium.has(fp)) row(j.finding.ruleId).wrongfulAtMedium++;
        if (everyHigh.has(fp)) row(j.finding.ruleId).wrongfulEveryHigh++;
        if (atDefault.has(fp)) row(j.finding.ruleId).wrongfulAtDefault++;
      }
    }
    if (tps > 0) {
      stats.tpEntries++;
      if (tpHigh > 0) stats.tpEntriesHigh++;
      if (atDefault.size > 0) stats.tpEntriesBlocked++;
      if (atMedium.size > 0) stats.tpEntriesBlockedMedium++;
    } else {
      if (atMedium.size > 0) stats.honestEntriesBlockedMedium++;
      stats.honestEntries++;
      if (atDefault.size > 0) stats.honestEntriesBlocked++;
      if (everyHigh.size > 0) stats.honestEntriesBlockedEveryHigh++;
    }
  }
  stats.rows = [...rows.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return stats;
}

export const HOOK_REPLAY_HEADING = '## Agent hook replay';

const share = (n: number, of: number): string => (of === 0 ? 'n/a' : `${Math.round((100 * n) / of)}%`);

export function renderHookReplayMarkdown(s: HookStats, date: string): string {
  const advice = s.rows.filter((r) => r.adviceOnly).map((r) => r.ruleId);
  const lines = [
    HOOK_REPLAY_HEADING,
    '',
    `Measured ${date} on the same ${s.entries} pull requests. Each one is applied as an uncommitted change on top of its base commit, the way a coding agent leaves it, and the Claude Code Stop hook (\`testwitness hook --agent claude\`) runs on it with the default settings: it blocks on open high findings only. A block is wrongful when the finding it rests on is not a true positive in the labels above.`,
    '',
    `* ${s.tpEntries} pull requests have at least one true positive finding. The hook blocks ${s.tpEntriesBlocked} of them (${share(s.tpEntriesBlocked, s.tpEntries)}). ${s.tpEntriesHigh} have a true positive at high severity; the others carry medium or low findings only, which the hook shows as advice.`,
    `* ${s.honestEntries} pull requests have no true positive finding. The hook blocks ${s.honestEntriesBlocked} of them. If every high finding blocked, it would block ${s.honestEntriesBlockedEveryHigh}.`,
    `* Rules with at least one wrongful block when every high finding blocks are advice only in the hook by default: ${advice.length ? advice.join(', ') : 'none'}. A maintainer can change the list with \`hook.advice_only\` in \`.testwitness.yml\`.`,
    `* With \`fail_on: medium\` in the base config the hook blocks ${s.tpEntriesBlockedMedium} of the ${s.tpEntries} pull requests with a true positive (${share(s.tpEntriesBlockedMedium, s.tpEntries)}) and ${s.honestEntriesBlockedMedium} of the ${s.honestEntries} without one; the last two columns give that setting per rule. V004 reads the pull request text, which does not exist yet when the hook runs, so the hook never reports it.`,
    '',
    '| Rule | True positives | Of them high | Blocked by the hook | Share of true positives blocked | Wrongful blocks if every high finding blocked | Wrongful blocks at the default | In the hook | Blocked with fail_on: medium | Wrongful blocks with fail_on: medium |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of s.rows) {
    lines.push(`| ${r.ruleId} | ${r.tp} | ${r.tpHigh} | ${r.tpBlocked} | ${share(r.tpBlocked, r.tp)} | ${r.wrongfulEveryHigh} | ${r.wrongfulAtDefault} | ${r.adviceOnly ? 'advice only' : 'blocks on high'} | ${r.tpBlockedMedium} | ${r.wrongfulAtMedium} |`);
  }
  lines.push('', 'The share is low for rules whose true positives are mostly medium: the hook does not block on medium unless the base config sets `fail_on: medium`. The numbers come from `corpus/runner/replay.test.ts`, which fails when this section and the measurement disagree. Regenerate with `pnpm corpus:report`.');
  return lines.join('\n') + '\n';
}
