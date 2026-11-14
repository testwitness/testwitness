import type { Finding, ResolvedConfig, Severity } from './types.js';

/**
 * Proven rules: the only rules whose findings v0.1 reports at medium or high.
 *
 * A rule is on this list when its findings held up on an untuned replay: ordinary merged pull requests from
 * repositories the rules were never tuned on, every medium and high finding judged by hand. The replay of 13 November
 * 2026 (300 pull requests, 20 unseen repositories) found no correct finding at medium or high for any other rule, so
 * every other rule still runs, but its findings are capped at low (informational) until it passes such a replay.
 * docs/how-we-measure-precision.md says how a rule earns its way onto the list; ROADMAP.md says which rule is next.
 */
export const PROVEN_RULES: readonly string[] = ['A002', 'R003', 'R004', 'R005'];

/**
 * The one exception to the cap: W006, the gate protecting itself. It reports a change to .testwitness.yml, to the
 * workflow step that runs testwitness, or to the agent hook config. It is not a judgement about test code, only a
 * maintainer may acknowledge it, and neither the corpus nor the untuned replay ever saw it fire wrongly.
 */
export const GATE_RULES: readonly string[] = ['W006'];

/**
 * Proven rules the agent hook blocks on only at high, whatever `fail_on` says. A002 (assertion loosened) is proven at
 * medium for the review state, but at medium it blocked one honest change on the corpus (a float comparison made
 * approximate) and one in the 300 pull request trial. Blocking an agent is more costly than a line in a review, so the
 * hook waits for high on A002. The pull request check still reports its medium findings.
 */
export const HOOK_HIGH_ONLY: readonly string[] = ['A002'];

/** The highest severity a finding of an unproven rule is reported at. */
export const UNPROVEN_SEVERITY_CAP: Severity = 'low';

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/**
 * Is this rule's output capped? Not for a proven rule, not for W006, and not when the repository opted the rule back
 * in by naming a severity for it in `.testwitness.yml` (`rules: { R001: medium }` or `rules: { R001: { severity: medium } }`).
 * A mapping without a severity (`rules: { R001: {} }`) does not opt a rule in.
 */
export function isCapped(ruleId: string, config: Pick<ResolvedConfig, 'rules'>): boolean {
  if (PROVEN_RULES.includes(ruleId) || GATE_RULES.includes(ruleId)) return false;
  return config.rules[ruleId]?.explicitSeverity !== true;
}

/**
 * Cap the findings of unproven rules at UNPROVEN_SEVERITY_CAP. The engine calls it once, after every rule ran and the
 * configured severities were applied, and before acknowledgements, the state and the summary are computed. Every
 * finding of a capped rule keeps what the rule itself said in `uncappedSeverity` (also when that was already low), so
 * the corpus report can keep measuring every rule. Returns how many findings were lowered.
 */
export function capUnproven(findings: Finding[], config: Pick<ResolvedConfig, 'rules'>): number {
  let lowered = 0;
  for (const f of findings) {
    if (!isCapped(f.ruleId, config)) continue;
    f.uncappedSeverity = f.severity;
    if (RANK[f.severity] > RANK[UNPROVEN_SEVERITY_CAP]) {
      f.severity = UNPROVEN_SEVERITY_CAP;
      lowered++;
    }
  }
  return lowered;
}

/** What the rule itself said about a finding, before the cap: for measurement only, never for gating. */
export function measuredSeverity(f: Pick<Finding, 'severity' | 'uncappedSeverity'>): Severity {
  return f.uncappedSeverity ?? f.severity;
}
