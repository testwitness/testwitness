import type { Acknowledgement, Finding } from './types.js';

export interface PullRequestComment {
  author: string;
  /** GitHub author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string;
  body: string;
  createdAt: string;
}

export interface AckCommand {
  ruleId: string | 'all';
  subject?: string;
  reason: string;
  by: string;
  at: string;
  trusted: boolean;
}

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Parse `/testwitness ack <RULE> <subject> reason: <text>` and
 * `/testwitness ack all reason: <text>` commands from PR comments.
 * Only comments by owners, members or collaborators who are not the PR author are trusted.
 */
export function parseAckCommands(comments: PullRequestComment[], prAuthor: string | undefined): AckCommand[] {
  const out: AckCommand[] = [];
  for (const c of comments) {
    const trusted = TRUSTED.has(c.association.toUpperCase()) && (!prAuthor || c.author.toLowerCase() !== prAuthor.toLowerCase());
    for (const line of c.body.split(/\r?\n/)) {
      const m = /^\s*\/testwitness\s+ack\s+(all|[A-Z]\d{3})(?:\s+(\S+))?\s*(?:reason:\s*(.*))?$/i.exec(line);
      if (!m) continue;
      const reason = (m[3] ?? '').trim();
      if (!reason) continue; // a reason is mandatory
      const ruleId = m[1]!.toLowerCase() === 'all' ? 'all' : m[1]!.toUpperCase();
      const cmd: AckCommand = { ruleId, reason, by: c.author, at: c.createdAt, trusted };
      if (m[2] && ruleId !== 'all') cmd.subject = m[2];
      out.push(cmd);
    }
  }
  return out;
}

/** Rules that only a maintainer may acknowledge, never the PR author or a label. */
export const MAINTAINER_ONLY = new Set(['W006']);

export function applyAcknowledgements(
  findings: Finding[],
  commands: AckCommand[],
  label: { present: boolean; by?: string; reason?: string; at?: string } = { present: false },
): void {
  for (const f of findings) {
    if (f.acknowledged) continue;
    const cmd = commands.find((c) => c.trusted && (c.ruleId === 'all' || (c.ruleId === f.ruleId && (!c.subject || subjectMatches(c.subject, f)))));
    if (cmd) {
      const ack: Acknowledgement = { by: cmd.by, reason: cmd.reason, at: cmd.at, via: 'comment' };
      f.acknowledged = ack;
      continue;
    }
    if (label.present && !MAINTAINER_ONLY.has(f.ruleId)) {
      f.acknowledged = { by: label.by ?? 'label', reason: label.reason ?? 'testwitness:acknowledged label', at: label.at ?? '', via: 'label' };
    }
  }
}

function subjectMatches(wanted: string, f: Finding): boolean {
  if (f.fingerprint === wanted) return true;
  const s = f.subject ?? '';
  if (s === wanted) return true;
  // Allow `Class#method`, `test_name`, or the tail of a describe path.
  return s.endsWith(`#${wanted}`) || s.endsWith(`::${wanted}`) || s.endsWith(` › ${wanted}`) || s.endsWith(`/${wanted}`);
}
