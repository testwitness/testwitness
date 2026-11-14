/**
 * Everything the Action prints to the step log. The runner reads the log for workflow commands: a line that starts
 * with `::name ...::` (and, in the older form, `##[name]` anywhere in a line) is a command, so `::stop-commands::`
 * silences every annotation after it, `::add-mask::` hides chosen words in the log and `::error::` forges a finding.
 * Text from the pull request (a file name can hold a line break, a results file can hold anything) therefore never
 * reaches the log as it is:
 *   * annotations go through @actions/core, which percent encodes `%`, CR and LF in the message and also `:` and `,`
 *     in the properties, after the text was reduced to one line of safe characters and cut;
 *   * every other line is one line of safe characters behind a fixed prefix, with `##[` broken up.
 */
import * as core from '@actions/core';
import { clipText, oneLine, type Finding } from '@testwitness/core';

/** Annotations shown per run; GitHub shows ten per level and step in the summary and keeps the rest on the Files tab. */
export const MAX_ANNOTATIONS = 200;
/** Longest annotation message. */
export const MAX_ANNOTATION_TEXT = 1000;
/** Longest log line written from untrusted text. */
export const MAX_LOG_TEXT = 2000;

/** One log line from text that may come from the pull request: single line, safe characters, no `##[`, cut. */
export function logLine(s: string): string {
  return clipText(oneLine(s), MAX_LOG_TEXT).replace(/##\[/g, '## [');
}

/** `core.info` for text that may come from the pull request. The prefix keeps the line from starting with `::`. */
export function info(s: string): void {
  core.info(`testwitness: ${logLine(s)}`);
}

export interface Annotation {
  level: 'error' | 'warning' | 'notice';
  message: string;
  properties: { file: string; startLine: number; title: string };
}

function level(f: Finding, strict: boolean): Annotation['level'] {
  if (f.severity === 'high') return strict ? 'error' : 'warning';
  if (f.severity === 'medium') return 'warning';
  return 'notice';
}

/** The annotations of a run: open findings, at most MAX_ANNOTATIONS, every text field made safe for the log. */
export function annotationsFor(findings: Finding[], strict: boolean): Annotation[] {
  const out: Annotation[] = [];
  for (const f of findings.slice(0, MAX_ANNOTATIONS)) {
    if (f.acknowledged) continue;
    const line = typeof f.location.line === 'number' && Number.isInteger(f.location.line) && f.location.line > 0 ? f.location.line : 1;
    out.push({
      level: level(f, strict),
      message: logLine(clipText(oneLine(`${f.message}${f.label ? ` (${f.label})` : ''}`), MAX_ANNOTATION_TEXT)) || 'finding',
      properties: { file: logLine(clipText(oneLine(String(f.location.path)), 1000)), startLine: line, title: `testwitness ${logLine(clipText(oneLine(String(f.ruleId)), 20))}` },
    });
  }
  return out;
}

/** Write the annotations as workflow commands. They render on the Files tab without any token. */
export function emitAnnotations(findings: Finding[], strict: boolean): number {
  const list = annotationsFor(findings, strict);
  for (const a of list) {
    if (a.level === 'error') core.error(a.message, a.properties);
    else if (a.level === 'warning') core.warning(a.message, a.properties);
    else core.notice(a.message, a.properties);
  }
  return list.length;
}

/** Author associations whose comments the Action may treat as its own report comment (besides bots). */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface ExistingComment {
  id: number;
  body?: string | null | undefined;
  user?: { login?: string | null; type?: string | null } | null | undefined;
  author_association?: string | null | undefined;
}

/**
 * The report comment of an earlier run, to update in place: the first comment that starts with the marker and was
 * written by a bot account or by someone with write access (a machine user's token). Anyone can post a comment that
 * holds the marker; the Action used to adopt the first such comment whoever wrote it, which put the report into a
 * comment its author could edit afterwards. A comment by anyone else is left alone and a new one is posted.
 */
export function findOwnComment<T extends ExistingComment>(comments: T[], marker: string): T | undefined {
  return comments.find((c) => (c.body ?? '').trimStart().startsWith(marker) && (c.user?.type === 'Bot' || TRUSTED_ASSOCIATIONS.has(c.author_association ?? '')));
}
