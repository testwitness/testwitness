import type { Finding, Report, Severity } from '../types.js';
import { clipText, oneLine } from './sanitize.js';

/**
 * Plain text for a terminal. The markdown renderer is for PR comments and reads badly in a shell (table pipes,
 * backslash escapes), so the CLI uses this one when stdout is a terminal.
 */
export interface TextOptions {
  /** ANSI colour. The caller decides (a terminal without NO_COLOR). */
  color?: boolean;
  /** Hide low findings behind a count, as the PR comment collapses them. */
  collapseLow?: boolean;
}

const STATE_TEXT: Record<Report['state'], string> = {
  pass: 'no finding at or above the configured threshold',
  review: 'this change alters what its tests prove; a reviewer should look',
  unreadable: 'the diff rules ran, but no test results were read to confirm what ran',
};

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

type Paint = (code: string, s: string) => string;

/**
 * Untrusted text (test names, PR text, file contents) must not drive the terminal: control characters, including
 * ESC and the C1 range, bidirectional and invisible characters become a visible placeholder, and line breaks of every
 * kind and tabs become spaces (sanitize.ts).
 */
export function plain(s: string): string {
  return oneLine(s);
}

/** Longest message or note line printed; a test name can be megabytes long. */
const TEXT_MAX = 1000;

function clip(s: string, max: number): string {
  const t = plain(s).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function sevPaint(s: Severity): string {
  return s === 'high' ? '31;1' : s === 'medium' ? '33' : '2';
}

function finding(f: Finding, paint: Paint): string[] {
  const loc = f.location.line ? `${f.location.path}:${f.location.line}` : f.location.path;
  const label = f.label ? ` (${clipText(plain(f.label), 200)})` : '';
  const out = [`  ${paint(sevPaint(f.severity), plain(f.severity).padEnd(6))}  ${paint('1', plain(f.ruleId))}  ${clipText(plain(loc), TEXT_MAX)}`];
  out.push(`          ${clipText(plain(f.message), TEXT_MAX)}${label}`);
  if (f.before !== undefined) out.push(paint('2', `          before: ${clip(f.before, 100)}`));
  if (f.after !== undefined) out.push(paint('2', `          after:  ${clip(f.after, 100)}`));
  return out;
}

function bySeverity(a: Finding, b: Finding): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.location.path.localeCompare(b.location.path) ||
    (a.location.line ?? 0) - (b.location.line ?? 0) ||
    a.ruleId.localeCompare(b.ruleId)
  );
}

export function renderText(report: Report, opts: TextOptions = {}): string {
  const paint: Paint = opts.color ? (code, s) => `\u001b[${code}m${s}\u001b[0m` : (_code, s) => s;
  const statePaint = report.state === 'pass' ? '32;1' : report.state === 'review' ? '33;1' : '36;1';
  const lines: string[] = [];
  lines.push(`testwitness: ${paint(statePaint, report.state)}, ${STATE_TEXT[report.state]}`);
  for (const n of report.notes ?? []) lines.push(`  ${clipText(plain(n), TEXT_MAX)}`);

  const open = report.findings.filter((f) => !f.acknowledged).sort(bySeverity);
  const shown = open.filter((f) => !(opts.collapseLow && f.severity === 'low'));
  const hiddenLow = open.length - shown.length;
  const acked = report.findings.filter((f) => f.acknowledged).length;

  if (shown.length) {
    lines.push('');
    for (const f of shown) lines.push(...finding(f, paint));
  }
  if (hiddenLow || acked) {
    lines.push('');
    if (hiddenLow) lines.push(paint('2', `  ${hiddenLow} low finding${hiddenLow === 1 ? '' : 's'} not shown (informational; --format markdown lists them)`));
    if (acked) lines.push(paint('2', `  ${acked} acknowledged finding${acked === 1 ? '' : 's'} not shown (--format markdown lists them)`));
  }

  lines.push('');
  const s = report.summary;
  lines.push(`${s.findings.high} high, ${s.findings.medium} medium, ${s.findings.low} low. Tests deleted ${s.testsDeleted}, skipped ${s.testsSkipped}, assertions weakened ${s.assertionsWeakened}.`);
  const e = report.evidence;
  if (e.state === 'unreadable') {
    lines.push('Results: none read, so whether the changed tests ran is unknown (pass --results to check).');
  } else {
    lines.push(`Results: ${e.total} tests in ${e.sources.length} file${e.sources.length === 1 ? '' : 's'}, ${e.passed} passed, ${e.failed} failed, ${e.errored} errored, ${e.skipped} skipped. Changed tests that did not run: ${s.changedTestsNotRun}.`);
  }
  for (const n of e.notes) lines.push(paint('2', `  ${clipText(plain(n), TEXT_MAX)}`));
  const files = report.files;
  lines.push(
    paint(
      '2',
      `${files.changed} file${files.changed === 1 ? '' : 's'} changed (${files.tests} test file${files.tests === 1 ? '' : 's'}), ${report.timing.totalMs} ms, testwitness ${report.tool.version}. Findings are observations, not verdicts.`,
    ),
  );
  return lines.join('\n') + '\n';
}
