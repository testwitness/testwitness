/**
 * Corpus runner: materialises each entry's files/base and files/head into a
 * temporary git repository, runs the engine, and compares findings with the
 * hand labels in expected.json. Also computes the per rule precision table.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from 'testwitness';
import type { Finding, Report } from '@testwitness/core';

export interface CorpusEntry {
  slug: string;
  dir: string;
  meta: { url: string; repo: string; language: string; category: string; split: 'tuning' | 'heldout'; title?: string };
  expected: Array<{ ruleId: string; severity?: string; subject?: string; label?: string; verdict?: string }>;
  manifest: Array<{ path: string; status: string; oldPath?: string }>;
}

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'corpus', GIT_AUTHOR_EMAIL: 'corpus@testwitness.local', GIT_COMMITTER_NAME: 'corpus', GIT_COMMITTER_EMAIL: 'corpus@testwitness.local' };
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV });

export function loadCorpus(root: string): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const dir = join(root, 'entries');
  for (const slug of readdirSync(dir).sort()) {
    const d = join(dir, slug);
    if (!existsSync(join(d, 'pr.json')) || !existsSync(join(d, 'files', 'manifest.json'))) continue;
    entries.push({
      slug,
      dir: d,
      meta: JSON.parse(readFileSync(join(d, 'pr.json'), 'utf8')),
      expected: JSON.parse(readFileSync(join(d, 'expected.json'), 'utf8')),
      manifest: JSON.parse(readFileSync(join(d, 'files', 'manifest.json'), 'utf8')),
    });
  }
  return entries;
}

export async function runEntry(e: CorpusEntry): Promise<Report> {
  const repo = mkdtempSync(join(tmpdir(), `tw-corpus-${e.slug}-`));
  try {
    git(repo, ['init', '-q', '-b', 'main']);
    const base = join(e.dir, 'files', 'base');
    const head = join(e.dir, 'files', 'head');
    if (existsSync(base)) cpSync(base, repo, { recursive: true });
    writeFileSync(join(repo, '.gitkeep'), '');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    // Remove files the manifest says were deleted or renamed away, then overlay head.
    for (const m of e.manifest) {
      if (m.status === 'deleted') rmSync(join(repo, m.path), { force: true });
      if (m.status === 'renamed' && m.oldPath) rmSync(join(repo, m.oldPath), { force: true });
    }
    if (existsSync(head)) cpSync(head, repo, { recursive: true });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'head', '--allow-empty']);
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const baseSha = git(repo, ['rev-parse', 'HEAD~1']).trim();
    // V004 entries keep the PR body (pr-body.md); every other entry is checked against the title only.
    const bodyFile = join(e.dir, 'pr-body.md');
    const { report } = await check({ cwd: repo, base: baseSha, head: headSha, junit: 'none/**/*.xml', format: 'json', quiet: true, log: () => {}, prTitle: e.meta.title ?? '', ...(existsSync(bodyFile) ? { prBodyFile: bodyFile } : {}) });
    return report;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

export interface Verdict {
  slug: string;
  split: 'tuning' | 'heldout';
  ruleId: string;
  severity: string;
  subject?: string;
  label?: string;
  verdict: 'tp' | 'expected-low' | 'fp' | 'missed';
}

/** Labels may give a bare test name; the engine gives a qualified name. */
export function subjectMatches(expected: string | undefined, actual: string | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  if (expected === actual) return true;
  return actual.endsWith(`#${expected}`) || actual.endsWith(`::${expected}`) || actual.endsWith(` › ${expected}`) || actual.endsWith(`/${expected}`);
}

/** A verdict with the finding it judges; `finding` is absent for a missed one. */
export interface Judged {
  verdict: Verdict;
  finding?: Finding;
}

/** Classify findings: expected ones are tp (or labelled fp when the label says so), unexpected ones on an honest entry are fp, expected but absent are missed. */
export function judge(e: CorpusEntry, findings: Finding[]): Verdict[] {
  return judgeFindings(e, findings).map((j) => j.verdict);
}

/** judge(), keeping each verdict next to its finding (the hook replay needs the fingerprint). */
export function judgeFindings(e: CorpusEntry, findings: Finding[]): Judged[] {
  const out: Judged[] = [];
  // V004 is judged only on entries that carry the PR body (pr-body.md); title only entries cannot support or refute a claim.
  const hasBody = existsSync(join(e.dir, 'pr-body.md'));
  const remaining = findings.filter((f) => f.ruleId !== 'V005' && (f.ruleId !== 'V004' || hasBody));
  for (const x of e.expected) {
    const i = remaining.findIndex((f) => f.ruleId === x.ruleId && (x.severity === undefined || f.severity === x.severity) && subjectMatches(x.subject, f.subject) && (x.label === undefined || f.label === x.label));
    if (i === -1) {
      // Only real weakenings can be missed; a benign low label the tool did not emit is not an error.
      if (x.verdict === 'fp') continue;
      out.push({ verdict: { slug: e.slug, split: e.meta.split, ruleId: x.ruleId, severity: x.severity ?? '?', verdict: 'missed', ...(x.subject ? { subject: x.subject } : {}) } });
    } else {
      const f = remaining[i]!;
      remaining.splice(i, 1);
      out.push({ finding: f, verdict: { slug: e.slug, split: e.meta.split, ruleId: f.ruleId, severity: f.severity, verdict: x.verdict === 'fp' ? 'expected-low' : 'tp', ...(f.subject ? { subject: f.subject } : {}), ...(f.label ? { label: f.label } : {}) } });
    }
  }
  for (const f of remaining) {
    // Low findings are informational by design (collapsed in the comment); on an honest entry they are benign, not false positives.
    const verdict: Verdict['verdict'] = f.severity === 'low' ? 'expected-low' : 'fp';
    out.push({ finding: f, verdict: { slug: e.slug, split: e.meta.split, ruleId: f.ruleId, severity: f.severity, verdict, ...(f.subject ? { subject: f.subject } : {}), ...(f.label ? { label: f.label } : {}) } });
  }
  return out;
}

export interface PrecisionRow {
  ruleId: string;
  split: string;
  tp: number;
  fp: number;
  missed: number;
  expectedLow: number;
  precision: number | null;
  highFp: number;
}

export function precisionTable(verdicts: Verdict[]): PrecisionRow[] {
  const key = (v: Verdict, split: string) => `${v.ruleId}|${split}`;
  const rows = new Map<string, PrecisionRow>();
  for (const v of verdicts) {
    for (const split of [v.split, 'all']) {
      const k = key(v, split);
      const r = rows.get(k) ?? { ruleId: v.ruleId, split, tp: 0, fp: 0, missed: 0, expectedLow: 0, precision: null, highFp: 0 };
      if (v.verdict === 'tp') r.tp++;
      else if (v.verdict === 'expected-low') r.expectedLow++;
      else if (v.verdict === 'fp') {
        r.fp++;
        if (v.severity === 'high') r.highFp++;
      } else r.missed++;
      rows.set(k, r);
    }
  }
  for (const r of rows.values()) r.precision = r.tp + r.fp > 0 ? r.tp / (r.tp + r.fp) : null;
  return [...rows.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.split.localeCompare(b.split));
}

export function renderPrecisionMarkdown(rows: PrecisionRow[], entries: number, date: string, heldout?: { entries: number; verdicts: Verdict[] }, notes?: string): string {
  const lines = [
    `# Precision on the false positive corpus`,
    '',
    `Measured ${date} on ${entries} public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.`,
    '',
    '| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(`| ${r.ruleId} | ${r.split} | ${r.tp} | ${r.expectedLow} | ${r.fp} | ${r.missed} | ${r.precision === null ? 'n/a' : r.precision.toFixed(2)} | ${r.highFp} |`);
  }
  if (heldout) {
    lines.push(
      '',
      '## Held out half',
      '',
      `Entries are split by the parity of the SHA-256 of the PR url (see corpus/README.md), so the labeller does not choose the split. No rule was tuned on these ${heldout.entries} entries. Precision here counts only medium and high findings: medium or high true positives over medium or high true positives plus false positives.`,
      '',
      '| Rule | True positives (medium or high) | False positives (medium or high) | Precision (medium or high) | Low true positives | Missed |',
      '|---|---|---|---|---|---|',
    );
    for (const r of heldoutTable(heldout.verdicts)) {
      lines.push(`| ${r.ruleId} | ${r.tp} | ${r.fp} | ${r.precision === null ? 'n/a' : r.precision.toFixed(2)} | ${r.lowTp} | ${r.missed} |`);
    }
  }
  if (notes) lines.push('', notes.trim());
  lines.push('', 'Regenerate with `pnpm corpus:report`.');
  return lines.join('\n') + '\n';
}

export interface HeldoutRow { ruleId: string; tp: number; fp: number; lowTp: number; missed: number; precision: number | null }

/** Per rule precision on the held out half, medium and high findings only. */
export function heldoutTable(verdicts: Verdict[]): HeldoutRow[] {
  const rows = new Map<string, HeldoutRow>();
  for (const v of verdicts) {
    if (v.split !== 'heldout') continue;
    const r = rows.get(v.ruleId) ?? { ruleId: v.ruleId, tp: 0, fp: 0, lowTp: 0, missed: 0, precision: null };
    const medHigh = v.severity === 'medium' || v.severity === 'high';
    if (v.verdict === 'tp') {
      if (medHigh) r.tp++;
      else r.lowTp++;
    } else if (v.verdict === 'fp') r.fp++;
    else if (v.verdict === 'missed') r.missed++;
    rows.set(v.ruleId, r);
  }
  for (const r of rows.values()) r.precision = r.tp + r.fp > 0 ? r.tp / (r.tp + r.fp) : null;
  return [...rows.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
