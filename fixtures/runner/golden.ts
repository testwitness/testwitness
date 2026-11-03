/**
 * Golden fixture runner. A case is fixtures/<project>/cases/<case>/ with
 *   base/   files before the PR (paths relative to the fixture project root)
 *   head/   files after the PR; a file present in base and absent in head is a deletion
 *   expected.json  [{ ruleId, severity?, subject?, label? }]
 *   pr.json (optional) { title, body }
 * The runner builds a temporary git repository with two commits and runs the
 * real engine through the CLI's check() so the whole path is exercised.
 */
// @ts-nocheck

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { check } from 'testwitness';
import type { Finding, Report } from '@testwitness/core';

export interface ExpectedFinding {
  ruleId: string;
  severity?: 'high' | 'medium' | 'low';
  subject?: string;
  label?: string;
}

export interface GoldenCase {
  project: string;
  name: string;
  dir: string;
  expected: ExpectedFinding[];
  pr?: { title: string; body: string };
  junit?: string;
}

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@testwitness.local', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@testwitness.local' };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV });
}

export function discoverCases(fixturesRoot: string, filter?: (c: GoldenCase) => boolean): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const project of readdirSync(fixturesRoot)) {
    const casesDir = join(fixturesRoot, project, 'cases');
    if (!existsSync(casesDir) || !statSync(casesDir).isDirectory()) continue;
    for (const name of readdirSync(casesDir).sort()) {
      const dir = join(casesDir, name);
      const expectedPath = join(dir, 'expected.json');
      if (!existsSync(expectedPath)) continue;
      const c: GoldenCase = { project, name, dir, expected: JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedFinding[] };
      const prPath = join(dir, 'pr.json');
      if (existsSync(prPath)) c.pr = JSON.parse(readFileSync(prPath, 'utf8')) as { title: string; body: string };
      if (existsSync(join(dir, 'junit'))) c.junit = join(dir, 'junit');
      if (!filter || filter(c)) out.push(c);
    }
  }
  return out;
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

/** Materialise a case into a temp repo and run the engine. Returns the report and the temp dir (caller removes). */
export async function runCase(c: GoldenCase, opts: { keep?: boolean } = {}): Promise<{ report: Report; repo: string }> {
  const repo = mkdtempSync(join(tmpdir(), `tw-${c.project}-${c.name}-`));
  try {
    git(repo, ['init', '-q', '-b', 'main']);
    const baseDir = join(c.dir, 'base');
    const headDir = join(c.dir, 'head');
    if (existsSync(baseDir)) cpSync(baseDir, repo, { recursive: true });
    writeFileSync(join(repo, '.gitkeep'), '');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base', '--allow-empty']);
    // Head: files in base but not in head are deleted; then copy head over.
    const baseFiles = new Set(listFiles(baseDir));
    const headFiles = new Set(listFiles(headDir));
    for (const f of baseFiles) if (!headFiles.has(f)) rmSync(join(repo, f), { force: true });
    if (existsSync(headDir)) cpSync(headDir, repo, { recursive: true });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'head', '--allow-empty']);
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const baseSha = git(repo, ['rev-parse', 'HEAD~1']).trim();
    let prBodyFile: string | undefined;
    if (c.pr) {
      prBodyFile = join(repo, '.pr-body.txt');
      writeFileSync(prBodyFile, c.pr.body);
    }
    const { report } = await check({
      cwd: repo,
      base: baseSha,
      head: headSha,
      junit: c.junit ? join(c.junit, '**/*.xml') : 'no-xml-for-this-case/**/*.xml',
      format: 'json',
      prTitle: c.pr?.title,
      prBodyFile,
      quiet: true,
      log: () => {},
    });
    return { report, repo };
  } finally {
    if (!opts.keep) rmSync(repo, { recursive: true, force: true });
  }
}

export function summarise(f: Finding): ExpectedFinding {
  const e: ExpectedFinding = { ruleId: f.ruleId, severity: f.severity };
  if (f.subject) e.subject = f.subject;
  if (f.label) e.label = f.label;
  return e;
}

/** Compare report findings to expectations. Each expected entry must match exactly one finding on the fields it specifies; no extra findings allowed. */
export function diffFindings(expected: ExpectedFinding[], actual: Finding[]): { missing: ExpectedFinding[]; unexpected: ExpectedFinding[] } {
  // V005 (no results attached) is informational and fires on every case without a junit directory; only compare it when a case asks for it.
  const compareV005 = expected.some((e) => e.ruleId === 'V005');
  const remaining = actual.filter((f) => compareV005 || f.ruleId !== 'V005');
  const missing: ExpectedFinding[] = [];
  for (const e of expected) {
    const i = remaining.findIndex(
      (f) => f.ruleId === e.ruleId && (e.severity === undefined || f.severity === e.severity) && (e.subject === undefined || f.subject === e.subject) && (e.label === undefined || f.label === e.label),
    );
    if (i === -1) missing.push(e);
    else remaining.splice(i, 1);
  }
  return { missing, unexpected: remaining.map(summarise) };
}
