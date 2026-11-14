/**
 * Golden fixture runner. A case is fixtures/<project>/cases/<case>/ with
 *   base/   files before the PR (paths relative to the fixture project root)
 *   head/   files after the PR; a file present in base and absent in head is a deletion
 *   expected.json  [{ ruleId, severity?, subject?, label? }]
 *   pr.json (optional) { title, body }
 *   junit/ (optional)    JUnit XML of the head run
 *   results/ (optional)  test results of the head run in any supported format (TAP, Jest, Vitest, pytest-json-report or
 *                        Playwright JSON, or JUnit XML), passed as the `results` globs; the reader tells them apart by content
 *   CRLF (optional) write the case with Windows line endings. One directive per line, `#` starts a comment:
 *     twin <case>       take base/, head/, expected.json, pr.json and the result
 *                       inputs from that LF case of the same project (the case's own copies win when present);
 *                       the suite then also requires the very same findings as the twin, line numbers,
 *                       messages and fingerprints included
 *     from <case>       take only base/ and head/ from that case (no expectations, no comparison)
 *     sides base|head|both  which commit gets CRLF (default both); the head side also converts the PR body
 *                       and the result inputs
 *     head base         the head commit is the base files again (a PR that only converts line endings)
 *   The temporary repository sets core.autocrlf false so git stores the CRLF bytes as written.
 * The runner builds a temporary git repository with two commits and runs the
 * real engine through the CLI's check() so the whole path is exercised.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
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
  results?: string;
  /** Present when the case directory has a CRLF file. */
  crlf?: CrlfMode;
}

export interface CrlfMode {
  sides: Array<'base' | 'head'>;
  /** Name of the LF case this case mirrors. */
  twin?: string;
  /** Name of a case whose base and head files this case uses, without its expectations. */
  from?: string;
  /** The head commit is the base files again. */
  headIsBase: boolean;
}

/** Parse a case's CRLF file (see the header comment). */
export function parseCrlfFile(text: string): CrlfMode {
  const mode: CrlfMode = { sides: ['base', 'head'], headIsBase: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, value] = line.split(/\s+/, 2) as [string, string | undefined];
    if (key === 'twin' && value) mode.twin = value;
    else if (key === 'from' && value) mode.from = value;
    else if (key === 'sides' && (value === 'base' || value === 'head')) mode.sides = [value];
    else if (key === 'sides' && value === 'both') mode.sides = ['base', 'head'];
    else if (key === 'head' && value === 'base') mode.headIsBase = true;
    else throw new Error(`CRLF: unknown directive ${JSON.stringify(line)}`);
  }
  return mode;
}

/** LF to CRLF for text; a buffer with a NUL byte is binary and kept as it is. */
export function toCrlf(buf: Buffer): Buffer {
  if (buf.includes(0)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
}

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@testwitness.local', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@testwitness.local' };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });
}

export function discoverCases(fixturesRoot: string, filter?: (c: GoldenCase) => boolean): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const project of readdirSync(fixturesRoot)) {
    const casesDir = join(fixturesRoot, project, 'cases');
    if (!existsSync(casesDir) || !statSync(casesDir).isDirectory()) continue;
    for (const name of readdirSync(casesDir).sort()) {
      const dir = join(casesDir, name);
      const crlfPath = join(dir, 'CRLF');
      const crlf = existsSync(crlfPath) ? parseCrlfFile(readFileSync(crlfPath, 'utf8')) : undefined;
      for (const other of [crlf?.twin, crlf?.from]) if (other && !existsSync(join(casesDir, other, 'expected.json'))) throw new Error(`${project}/${name}: CRLF names ${other}, which is not a case`);
      // Inputs come from the case directory, then from the twin's.
      const dirs = crlf?.twin ? [dir, join(casesDir, crlf.twin)] : [dir];
      const find = (...rel: string[]): string | undefined => dirs.map((d) => join(d, ...rel)).find((p) => existsSync(p));
      const expectedPath = find('expected.json');
      if (!expectedPath && crlf) throw new Error(`${project}/${name}: a CRLF case needs expected.json or a twin`);
      if (!expectedPath) continue;
      const c: GoldenCase = { project, name, dir, expected: JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedFinding[] };
      if (crlf) c.crlf = crlf;
      const prPath = find('pr.json');
      if (prPath) c.pr = JSON.parse(readFileSync(prPath, 'utf8')) as { title: string; body: string };
      const junit = find('junit');
      if (junit) c.junit = junit;
      const results = find('results');
      if (results) c.results = results;
      if (!filter || filter(c)) out.push(c);
    }
  }
  return out;
}

/**
 * Copy a case tree into the repo by reading and writing each file, never with cpSync.
 * On Windows cpSync keeps the source file's modification time, and when a head file has
 * the same size and mtime second as the base file it overwrites, git's index treats it as
 * unchanged and the head commit silently drops the change (seen as flaky V003, A001 and
 * A002 failures on windows-latest). Writing gives every file a fresh mtime.
 */
function writeTree(from: string, to: string, crlf = false): void {
  if (!existsSync(from)) return;
  for (const rel of listFiles(from)) {
    const target = join(to, rel);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readFileSync(join(from, rel));
    writeFileSync(target, crlf ? toCrlf(bytes) : bytes);
  }
}

/** Base and head directories of a case, the twin's when the case has none of its own. */
export function caseDirs(c: GoldenCase): { baseDir: string; headDir: string } {
  const src = (side: string): string => {
    const own = join(c.dir, side);
    const other = c.crlf?.twin ?? c.crlf?.from;
    if (existsSync(own) || !other) return own;
    return join(dirname(c.dir), other, side);
  };
  const baseDir = src('base');
  return { baseDir, headDir: c.crlf?.headIsBase ? baseDir : src('head') };
}

/** A CRLF copy of an evidence directory or file, so readers see Windows line endings too. */
function crlfCopy(path: string | undefined, into: string, name: string): string | undefined {
  if (!path) return undefined;
  const target = join(into, name);
  if (statSync(path).isDirectory()) writeTree(path, target, true);
  else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, toCrlf(readFileSync(path)));
  }
  return target;
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
  const crlfBase = c.crlf?.sides.includes('base') ?? false;
  const crlfHead = c.crlf?.sides.includes('head') ?? false;
  // Evidence of a CRLF head is converted too, outside the repository so it is not committed.
  const evidenceDir = crlfHead ? mkdtempSync(join(tmpdir(), `tw-ev-${c.project}-${c.name}-`)) : undefined;
  try {
    git(repo, ['init', '-q', '-b', 'main']);
    // Store the bytes as written whatever the runner's global config says (Windows images set autocrlf true).
    git(repo, ['config', 'core.autocrlf', 'false']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    const { baseDir, headDir } = caseDirs(c);
    writeTree(baseDir, repo, crlfBase);
    writeFileSync(join(repo, '.gitkeep'), '');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base', '--allow-empty']);
    // Head: files in base but not in head are deleted; then copy head over.
    const baseFiles = new Set(listFiles(baseDir));
    const headFiles = new Set(listFiles(headDir));
    for (const f of baseFiles) if (!headFiles.has(f)) rmSync(join(repo, f), { force: true });
    writeTree(headDir, repo, crlfHead);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'head', '--allow-empty']);
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const baseSha = git(repo, ['rev-parse', 'HEAD~1']).trim();
    let prBodyFile: string | undefined;
    if (c.pr) {
      prBodyFile = join(repo, '.pr-body.txt');
      writeFileSync(prBodyFile, crlfHead ? toCrlf(Buffer.from(c.pr.body, 'utf8')) : c.pr.body);
    }
    const ev = evidenceDir
      ? { results: crlfCopy(c.results, evidenceDir, 'results'), junit: crlfCopy(c.junit, evidenceDir, 'junit') }
      : c;
    const { report } = await check({
      cwd: repo,
      base: baseSha,
      head: headSha,
      // Globs, not paths: always forward slashes, also on Windows.
      results: ev.results ? `${ev.results.split(sep).join('/')}/**/*` : undefined,
      junit: ev.junit ? `${ev.junit.split(sep).join('/')}/**/*.xml` : 'no-xml-for-this-case/**/*.xml',
      format: 'json',
      prTitle: c.pr?.title,
      prBodyFile,
      quiet: true,
      log: () => {},
    });
    return { report, repo };
  } finally {
    if (!opts.keep) rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (evidenceDir) rmSync(evidenceDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** Everything a finding says, for comparing a CRLF case with its LF twin. */
export function fullFinding(f: Finding): Record<string, unknown> {
  return { ruleId: f.ruleId, severity: f.severity, subject: f.subject, label: f.label, message: f.message, location: f.location, fingerprint: f.fingerprint, before: f.before, after: f.after };
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
