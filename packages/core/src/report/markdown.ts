import type { Finding, Report, Severity } from '../types.js';
import { clipText, oneLine } from './sanitize.js';

export const COMMENT_MARKER = '<!-- testwitness-report -->';

const STATE_LINE: Record<Report['state'], string> = {
  pass: 'pass: no finding at or above the configured threshold',
  review: 'review: this PR changed what its tests prove. A reviewer should look.',
  unreadable: 'unreadable: the diff rules ran, but no test results were available to confirm what ran',
};

/** Longest run of untrusted text in one cell or note; longer text is cut with a visible mark. */
export const MARKDOWN_MAX_TEXT = 600;
/** Longest path shown in the Where column. */
export const MARKDOWN_MAX_PATH = 300;

/**
 * Escape untrusted text (PR bodies, test names, file contents) before it lands in Markdown. In order:
 *   1. one line of safe characters (sanitize.ts): no control, bidirectional or invisible characters, no line break of
 *      any kind (a lone CR also ends a line in CommonMark and would end a table row);
 *   2. cut to `max` characters;
 *   3. `&` becomes `&amp;`, so the text cannot bring its own character references: GitHub decodes `&#64;name` to a
 *      mention and `https&colon;//host` to a link after the Markdown is parsed, which went around steps 5 and 6;
 *   4. every Markdown special character gets a backslash (a tilde only where it could open a strikethrough);
 *   5. no mentions: GitHub decodes &#64; back to @ before it looks for mentions, so a zero width space follows it, as
 *      Renovate does; the same after `#` and `GH-` in front of a digit, which GitHub links to an issue (and, with
 *      `owner/repo#1`, writes a back reference into another repository);
 *   6. no bare links: a zero width space after every colon in front of `//`, and inside every `www.`, stops the
 *      autolink. Every one, not only those after a word boundary: `%25http://host` has none before `http`.
 */
export function esc(s: string, max = MARKDOWN_MAX_TEXT): string {
  return clipText(oneLine(s), max)
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_{}[\]()#+!|<>]/g, (c) => `\\${c}`)
    .replace(/~(?=\S)/g, '\\~')
    .replace(/#(?=\d)/g, '#&#8203;')
    .replace(/@/g, '&#64;&#8203;')
    .replace(/\bGH-(?=\d)/gi, (m) => `${m}&#8203;`)
    .replace(/:(?=\/\/)/g, ':&#8203;')
    .replace(/www\./gi, (w) => `${w.slice(0, 3)}&#8203;.`);
}

/**
 * `esc` for text that starts a line or a list item (notes, warnings, names in a list). There a dash or a plus starts a
 * list, `---` a rule, `===` a heading underline, `1.` a numbered list and four spaces a code block: leading whitespace
 * is dropped and the first character is escaped where it could start one of those.
 */
export function escBlock(s: string, max = MARKDOWN_MAX_TEXT): string {
  return esc(oneLine(s).trimStart(), max)
    .replace(/^[-=]/, (c) => `\\${c}`)
    .replace(/^(\d{1,9})\./, '$1\\.');
}

/**
 * A count for the report. A report rendered from a JSON file (the workflow_run pattern in docs/security.md renders a
 * report a fork run wrote) may hold anything where a number should be, so nothing is printed that is not a number.
 */
function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '?';
}

/**
 * Text for a code span inside a table cell. Backslash escapes are literal inside a code span (esc would show
 * test\_money.py), so only what can break out is changed: a backtick would end the span and a pipe the cell. Table
 * parsers disagree on a backslash in front of an escaped pipe (cmark-gfm pairs backslashes, so `\\|` is a literal
 * backslash and then a cell boundary), so a backslash directly before a pipe becomes a forward slash. The text is one
 * line of safe characters, cut to MARKDOWN_MAX_PATH.
 */
export function codeCell(s: string, max = MARKDOWN_MAX_PATH): string {
  // An empty code span is no code span (two backticks are shown as they are), so an empty path gets a mark.
  return (clipText(oneLine(s), max) || '?')
    .replace(/`/g, "'")
    .split('|')
    .map((part, i, parts) => (i < parts.length - 1 ? slashesAtEnd(part) : part))
    .join('\\|');
}

/** Trailing backslashes of a cell part as forward slashes (one pass; a regex with a lookahead was quadratic). */
function slashesAtEnd(part: string): string {
  let end = part.length;
  while (end > 0 && part[end - 1] === '\\') end--;
  return end === part.length ? part : part.slice(0, end) + '/'.repeat(part.length - end);
}

function sevIcon(s: Severity): string {
  return s === 'high' ? 'high' : s === 'medium' ? 'medium' : 'low';
}

function row(f: Finding): string {
  const loc = f.location.line ? `${String(f.location.path)}:${num(f.location.line)}` : String(f.location.path);
  const label = f.label ? ` (${esc(f.label)})` : '';
  const ack = f.acknowledged ? ` acknowledged by ${esc(f.acknowledged.by)}: ${esc(f.acknowledged.reason)}` : '';
  return `| ${esc(String(f.ruleId), 40)} | ${sevIcon(f.severity)} | \`${codeCell(loc)}\` | ${esc(String(f.message))}${label}${ack} |`;
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
  lines.push(`## ${opts.title ?? 'testwitness'}: ${esc(String(report.state), 40)}`);
  lines.push('');
  lines.push(Object.hasOwn(STATE_LINE, report.state) ? STATE_LINE[report.state] : '');
  for (const n of report.notes ?? []) lines.push('', escBlock(n));
  lines.push('');
  const s = report.summary;
  lines.push('**Summary**');
  lines.push('');
  lines.push(`- Tests deleted: ${num(s.testsDeleted)}`);
  lines.push(`- Tests skipped or expected to fail: ${num(s.testsSkipped)}`);
  lines.push(`- Assertions removed or loosened: ${num(s.assertionsWeakened)}`);
  lines.push(`- Changed tests that did not run: ${report.evidence.state === 'unreadable' ? 'unknown (no results)' : num(s.changedTestsNotRun)}`);
  lines.push(`- Findings: ${num(s.findings.high)} high, ${num(s.findings.medium)} medium, ${num(s.findings.low)} low`);
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
    lines.push('- No test results read.');
  } else {
    const formats = e.formats?.length && !(e.formats.length === 1 && e.formats[0] === 'junit-xml') ? ` (${e.formats.map(formatName).join(', ')})` : '';
    lines.push(`- Read ${e.sources.length} result file${e.sources.length === 1 ? '' : 's'}${formats}: ${num(e.total)} tests, ${num(e.passed)} passed, ${num(e.failed)} failed, ${num(e.errored)} errored, ${num(e.skipped)} skipped${e.flaky ? `, ${num(e.flaky)} flaky` : ''}`);
  }
  for (const n of e.notes) lines.push(`- ${escBlock(n)}`);
  const c = report.coverage;
  if (c) {
    lines.push(`- Coverage: ${c.sources.length} report${c.sources.length === 1 ? '' : 's'}, ${num(c.files)} source file${c.files === 1 ? '' : 's'}, ${num(c.linesExecuted)} of ${num(c.linesInstrumented)} instrumented lines executed`);
    for (const n of c.notes) lines.push(`- ${escBlock(n)}`);
  }
  lines.push('');

  const hi = report.helperIndex;
  if (hi && (hi.resolved.length || hi.warnings.length)) {
    lines.push('**Helpers in other files**');
    lines.push('');
    for (const w of hi.warnings) lines.push(`- ${escBlock(w)}`);
    if (hi.resolved.length) {
      lines.push('<details>');
      lines.push(`<summary>${hi.resolved.length} call${hi.resolved.length === 1 ? '' : 's'} counted as assertions through helpers defined in other files</summary>`);
      lines.push('');
      for (const r of hi.resolved.slice(0, 50)) lines.push(`- ${escBlock(r.test)} (${esc(r.path)}:${num(r.line)}): counted via helper ${esc(r.helper)} in ${esc(r.definedIn)}:${num(r.definedLine)}`);
      if (hi.resolved.length > 50) lines.push(`- ${hi.resolved.length - 50} more in the JSON report`);
      lines.push('');
      lines.push('</details>');
    }
    lines.push('');
  }

  if (report.provenance.agents.length || report.provenance.botAuthor) {
    lines.push('**Provenance**');
    lines.push('');
    for (const a of report.provenance.agents) lines.push(`- ${escBlock(a.name)}: ${a.signals.map((x) => esc(x)).join('; ')}`);
    if (report.provenance.botAuthor) lines.push(`- Bot author: ${esc(report.provenance.botAuthor)}`);
    lines.push('');
  }

  lines.push(`<sub>testwitness ${esc(String(report.tool.version), 40)}, mode ${esc(String(report.mode), 40)}, ${num(report.files.changed)} files changed (${num(report.files.tests)} test files), ${num(report.timing.totalMs)} ms. Findings are observations, not verdicts. Acknowledge one with a reason in \`.testwitness.yml\`.</sub>`);
  return lines.join('\n') + '\n';
}

const FORMAT_NAMES: Record<string, string> = {
  'junit-xml': 'JUnit XML',
  tap: 'TAP',
  'jest-json': 'Jest JSON',
  'vitest-json': 'Vitest JSON',
  'pytest-json-report': 'pytest-json-report',
  'playwright-json': 'Playwright JSON',
};

function formatName(f: string): string {
  return Object.hasOwn(FORMAT_NAMES, f) ? FORMAT_NAMES[f]! : esc(String(f), 40);
}
