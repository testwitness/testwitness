import type { Finding, Report, Severity } from '../types.js';

export const COMMENT_MARKER = '<!-- testwitness-report -->';

const STATE_LINE: Record<Report['state'], string> = {
  pass: 'pass: no finding at or above the configured threshold',
  review: 'review: this PR changed what its tests prove. A reviewer should look.',
  unreadable: 'unreadable: the diff rules ran, but no test results were available to confirm what ran',
};

/** Escape untrusted text (PR bodies, test names) before it lands in Markdown. */
export function esc(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|<>]/g, (c) => `\\${c}`).replace(/\r?\n/g, ' ');
}

function sevIcon(s: Severity): string {
  return s === 'high' ? 'high' : s === 'medium' ? 'medium' : 'low';
}

function row(f: Finding): string {
  const loc = f.location.line ? `${f.location.path}:${f.location.line}` : f.location.path;
  const label = f.label ? ` (${esc(f.label)})` : '';
  const ack = f.acknowledged ? ` acknowledged by ${esc(f.acknowledged.by)}: ${esc(f.acknowledged.reason)}` : '';
  return `| ${f.ruleId} | ${sevIcon(f.severity)} | \`${esc(loc)}\` | ${esc(f.message)}${label}${ack} |`;
}

export interface MarkdownOptions {
  collapseLow?: boolean;
  /** Include the hidden marker used to update the comment in place. */
  marker?: boolean;
  title?: string;
}

export function renderMarkdown(report: Report, opts: MarkdownOptions = {}): string {
  const lines: string[] = [];
  if (opts.marker !== false) lines.push(COMMENT_MARKER);
  lines.push(`## ${opts.title ?? 'testwitness'}: ${report.state}`);
  lines.push('');
  lines.push(STATE_LINE[report.state]);
  lines.push('');
  const s = report.summary;
  lines.push('**Summary**');
  lines.push('');
  lines.push(`- Tests deleted: ${s.testsDeleted}`);
  lines.push(`- Tests skipped or expected to fail: ${s.testsSkipped}`);
  lines.push(`- Assertions removed or loosened: ${s.assertionsWeakened}`);
  lines.push(`- Changed tests that did not run: ${report.evidence.state === 'unreadable' ? 'unknown (no results)' : s.changedTestsNotRun}`);
  lines.push(`- Findings: ${s.findings.high} high, ${s.findings.medium} medium, ${s.findings.low} low`);
  lines.push('');

  const open = report.findings.filter((f) => !f.acknowledged);
  const acked = report.findings.filter((f) => f.acknowledged);
  const main = open.filter((f) => !(opts.collapseLow && f.severity === 'low'));
  const low = open.filter((f) => opts.collapseLow && f.severity === 'low');

  if (main.length) {
    lines.push('**Findings**');
    lines.push('');
    lines.push('| Rule | Severity | Where | What |');
    lines.push('|---|---|---|---|');
    for (const f of main) lines.push(row(f));
    lines.push('');
  }
  if (low.length) {
    lines.push('<details>');
    lines.push(`<summary>${low.length} low severity finding${low.length === 1 ? '' : 's'}</summary>`);
    lines.push('');
    lines.push('| Rule | Severity | Where | What |');
    lines.push('|---|---|---|---|');
    for (const f of low) lines.push(row(f));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (acked.length) {
    lines.push('<details>');
    lines.push(`<summary>${acked.length} acknowledged</summary>`);
    lines.push('');
    lines.push('| Rule | Severity | Where | What |');
    lines.push('|---|---|---|---|');
    for (const f of acked) lines.push(row(f));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  lines.push('**Evidence**');
  lines.push('');
  const e = report.evidence;
  if (e.state === 'unreadable') {
    lines.push('- No JUnit XML read.');
  } else {
    lines.push(`- Read ${e.sources.length} result file${e.sources.length === 1 ? '' : 's'}: ${e.total} tests, ${e.passed} passed, ${e.failed} failed, ${e.errored} errored, ${e.skipped} skipped${e.flaky ? `, ${e.flaky} flaky` : ''}`);
  }
  for (const n of e.notes) lines.push(`- ${esc(n)}`);
  const c = report.coverage;
  if (c) {
    lines.push(`- Coverage: ${c.sources.length} report${c.sources.length === 1 ? '' : 's'}, ${c.files} source file${c.files === 1 ? '' : 's'}, ${c.linesExecuted} of ${c.linesInstrumented} instrumented lines executed`);
    for (const n of c.notes) lines.push(`- ${esc(n)}`);
  }
  const h = report.history;
  if (h) {
    lines.push(
      h.runs > 0
        ? `- History: ${h.runs} earlier run${h.runs === 1 ? '' : 's'}, ${h.tests} test${h.tests === 1 ? '' : 's'} tracked, from ${esc(h.source)}; ${h.adjusted} finding${h.adjusted === 1 ? '' : 's'} graded by history`
        : `- History: none read from ${esc(h.source)}; severities do not use earlier runs`,
    );
    for (const n of h.notes) lines.push(`- ${esc(n)}`);
  }
  lines.push('');

  const hi = report.helperIndex;
  if (hi && (hi.resolved.length || hi.warnings.length)) {
    lines.push('**Helpers in other files**');
    lines.push('');
    for (const w of hi.warnings) lines.push(`- ${esc(w)}`);
    if (hi.resolved.length) {
      lines.push('<details>');
      lines.push(`<summary>${hi.resolved.length} call${hi.resolved.length === 1 ? '' : 's'} counted as assertions through helpers defined in other files</summary>`);
      lines.push('');
      for (const r of hi.resolved.slice(0, 50)) lines.push(`- ${esc(r.test)} (${esc(r.path)}:${r.line}): counted via helper ${esc(r.helper)} in ${esc(r.definedIn)}:${r.definedLine}`);
      if (hi.resolved.length > 50) lines.push(`- ${hi.resolved.length - 50} more in the JSON report`);
      lines.push('');
      lines.push('</details>');
    }
    lines.push('');
  }

  if (report.provenance.agents.length || report.provenance.botAuthor) {
    lines.push('**Provenance**');
    lines.push('');
    for (const a of report.provenance.agents) lines.push(`- ${esc(a.name)}: ${a.signals.map(esc).join('; ')}`);
    if (report.provenance.botAuthor) lines.push(`- Bot author: ${esc(report.provenance.botAuthor)}`);
    lines.push('');
  }

  lines.push(`<sub>testwitness ${report.tool.version}, mode ${report.mode}, ${report.files.changed} files changed (${report.files.tests} test files), ${report.timing.totalMs} ms. Findings are observations, not verdicts. Acknowledge one with a reason in \`.testwitness.yml\`.</sub>`);
  return lines.join('\n') + '\n';
}
