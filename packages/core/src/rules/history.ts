/**
 * Dynamic severity from run history. Three adjustments, all counting, none learning (docs/history.md):
 *
 *   1. R001, R003 or R004 on a test that failed or errored in at least 2 of its last 5 recorded runs: high, label
 *      `hides failure`, and the message states the count.
 *   2. R003 with an issue reference in the reason (label `tracked`) on a test the history records as flaky: severity
 *      unchanged, label `flaky in history`, and the message states the counts.
 *   3. V003 on a test recorded in every one of the last 5 runs of the history: high, label `ran before, not now`.
 *
 * A finding the rule already graded low because the test survives elsewhere or only partly stops running (moved,
 * parameterised, rewritten, replaced, refactored, production removed, version dropped, conditional, one case, partial results) is left
 * alone: the history says the test was failing, not that this change hides it.
 */

import type { ChangedFile, Finding, LanguageId } from '../types.js';
import { inventoryKeys } from '../evidence/normalise.js';
import { HISTORY_RECENT, lookupHistory, type HistoryDocument, type HistoryStats } from '../history/history.js';

/** Labels that mean the rule found the test still runs somewhere, or only some of it stopped running. */
const EXCUSED = new Set(['moved', 'parameterised', 'rewritten', 'replaced', 'refactored', 'production removed', 'version dropped', 'conditional', 'one case', 'partial results']);

export const HIDES_FAILURE_RULES = new Set(['R001', 'R003', 'R004']);

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The text appended to the message for each adjustment. Exported for the docs and tests. */
export function hidesFailureReason(s: HistoryStats): string {
  return `failed in ${s.recentFailed} of the last ${plural(s.recentRuns, 'run')}`;
}
export function flakyReason(s: HistoryStats): string {
  return `flaky in history: passed in ${s.passed} and failed in ${s.failed} of the last ${plural(s.seen, 'run')}, reran in ${s.rerunRuns}`;
}
export function ranBeforeReason(): string {
  return `it ran in each of the last ${HISTORY_RECENT} runs`;
}

/**
 * Apply the history adjustments to the findings of one rule, in place, before the configured severity shift.
 * Returns how many findings changed.
 */
export function applyHistory(findings: Finding[], doc: HistoryDocument, files: ChangedFile[]): number {
  const langOf = new Map<string, LanguageId | undefined>(files.map((f) => [f.path, f.language]));
  let changed = 0;
  for (const f of findings) {
    if (!f.subject) continue;
    if (!HIDES_FAILURE_RULES.has(f.ruleId) && f.ruleId !== 'V003') continue;
    if (f.label && EXCUSED.has(f.label)) continue;
    const lang = langOf.get(f.location.path);
    if (!lang) continue;
    const hit = lookupHistory(doc, inventoryKeys(f.location.path, f.subject, lang));
    if (!hit) continue;
    const s = hit.stats;
    if (HIDES_FAILURE_RULES.has(f.ruleId) && s.recentFailed >= 2) {
      f.severity = 'high';
      f.label = 'hides failure';
      f.message = `${f.message}; ${hidesFailureReason(s)}`;
      changed++;
      continue;
    }
    if (f.ruleId === 'R003' && f.label === 'tracked' && s.flaky) {
      f.label = 'flaky in history';
      f.message = `${f.message}; ${flakyReason(s)}`;
      changed++;
      continue;
    }
    if (f.ruleId === 'V003' && s.seenInEveryRecentRun) {
      f.severity = 'high';
      f.label = 'ran before, not now';
      f.message = `${f.message}; ${ranBeforeReason()}`;
      changed++;
    }
  }
  return changed;
}
