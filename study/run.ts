/**
 * Runs the engine in diff only mode (no JUnit evidence) on every fetched PR.
 * Same approach as corpus/runner/corpus.ts: files/base is committed into a
 * temporary git repository, deletions and renames are applied, files/head is
 * overlaid and committed, and the engine compares the two commits. The PR title
 * and the stored body are passed as PR text so V004 can run. Default
 * configuration for every PR (a PR's own .testwitness.yml is not honoured, so
 * every cohort is measured with the same rules).
 *
 * usage: tsx --conditions=development study/run.ts [--dir study] [--force]
 * Writes data/<slug>/report.json (local only), results.csv and findings.jsonl.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allChanges, isSkipped, isXfail, parseConfig, ruleMap, runEngine, type Finding } from '../packages/core/src/index.js';
import { allFrontEnds } from '../packages/cli/src/frontends.js';
import { log, readJsonl, sha256, slugOf, studyDir, type Rejected, type SampleRow } from './lib.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'study', GIT_AUTHOR_EMAIL: 'study@testwitness.local', GIT_COMMITTER_NAME: 'study', GIT_COMMITTER_EMAIL: 'study@testwitness.local' };
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, maxBuffer: 256 * 1024 * 1024 });

interface StoredRun {
  url: string;
  newTests: number;
  newTestsEvaluable: number;
  findings: Finding[];
  error?: string;
}

async function runOne(d: string, title: string, body: string): Promise<StoredRun & { url: string }> {
  const manifest: Array<{ path: string; status: string; oldPath?: string }> = JSON.parse(readFileSync(join(d, 'files', 'manifest.json'), 'utf8'));
  const repo = mkdtempSync(join(tmpdir(), 'tw-study-'));
  try {
    git(repo, ['init', '-q', '-b', 'main']);
    const base = join(d, 'files', 'base');
    const head = join(d, 'files', 'head');
    if (existsSync(base)) cpSync(base, repo, { recursive: true });
    writeFileSync(join(repo, '.gitkeep'), '');
    git(repo, ['add', '-A', '-f']);
    git(repo, ['commit', '-q', '-m', 'base']);
    for (const m of manifest) {
      if (m.status === 'deleted') rmSync(join(repo, m.path), { force: true });
      if (m.status === 'renamed' && m.oldPath) rmSync(join(repo, m.oldPath), { force: true });
    }
    if (existsSync(head)) cpSync(head, repo, { recursive: true });
    git(repo, ['add', '-A', '-f']);
    git(repo, ['commit', '-q', '-m', 'head', '--allow-empty']);
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const baseSha = git(repo, ['rev-parse', 'HEAD~1']).trim();
    const config = parseConfig(undefined, ruleMap());
    const { report, pairs } = await runEngine({
      cwd: repo,
      base: baseSha,
      head: headSha,
      frontEnds: allFrontEnds(),
      config,
      evidence: undefined,
      prText: { title, body },
      log: () => {},
    });
    const added = allChanges(pairs).filter((c) => c.change.kind === 'added');
    // Denominator for O001 and O002: new tests those rules can judge (same filters as O001).
    const evaluable = added.filter((c) => {
      if (c.change.kind !== 'added') return false;
      const t = c.change.head;
      return t.statementCount > 0 && !t.overrideOnly && !isSkipped(t) && !isXfail(t);
    });
    return { url: '', newTests: added.length, newTestsEvaluable: evaluable.length, findings: report.findings };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const dir = studyDir();
  const force = process.argv.includes('--force');
  const rejected = new Set(readJsonl<Rejected>(join(dir, 'rejected.jsonl')).map((r) => r.url));
  const rows = readJsonl<SampleRow>(join(dir, 'sample.jsonl')).filter((r) => !rejected.has(r.url));
  const dataDir = join(dir, 'data');
  const present = new Set(existsSync(dataDir) ? readdirSync(dataDir) : []);
  const csv = ['url,agent,language,stars,changed_lines,test_files,new_tests,new_tests_evaluable,rules,any_high,any_medium,error'];
  const findingsOut: string[] = [];
  let ran = 0;
  let errors = 0;
  for (const r of rows) {
    const slug = slugOf(r.repo, r.number);
    const d = join(dataDir, slug);
    if (!present.has(slug) || !existsSync(join(d, 'files', 'manifest.json'))) continue;
    const reportFile = join(d, 'report.json');
    let res: StoredRun;
    if (!force && existsSync(reportFile)) {
      res = JSON.parse(readFileSync(reportFile, 'utf8'));
    } else {
      const t0 = Date.now();
      try {
        const body = existsSync(join(d, 'pr-body.md')) ? readFileSync(join(d, 'pr-body.md'), 'utf8') : '';
        res = { ...(await runOne(d, r.title, body)), url: r.url };
      } catch (e) {
        res = { url: r.url, newTests: 0, newTestsEvaluable: 0, findings: [], error: String((e as Error).message).split('\n')[0]!.slice(0, 200) };
      }
      writeFileSync(reportFile, JSON.stringify(res, null, 1));
      log(`${slug}: ${res.findings.length} findings, ${res.newTests} new tests, ${Date.now() - t0} ms${res.error ? ` ERROR ${res.error}` : ''}`);
    }
    ran++;
    if (res.error) errors++;
    const counts = new Map<string, number>();
    for (const f of res.findings) counts.set(`${f.ruleId}:${f.severity}`, (counts.get(`${f.ruleId}:${f.severity}`) ?? 0) + 1);
    const rules = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}:${n}`).join(';');
    csv.push(
      [r.url, r.agent, r.language, r.stars, r.changed_lines, r.test_files, res.newTests, res.newTestsEvaluable, rules, res.findings.some((f) => f.severity === 'high'), res.findings.some((f) => f.severity === 'medium'), res.error ?? '']
        .map(csvCell)
        .join(','),
    );
    const pr = sha256(r.url).slice(0, 16);
    for (const f of res.findings) {
      findingsOut.push(JSON.stringify({ pr, agent: r.agent, language: r.language, rule: f.ruleId, severity: f.severity, label: f.label ?? null, subject_sha256: f.subject ? sha256(f.subject) : null }));
    }
  }
  writeFileSync(join(dir, 'results.csv'), csv.join('\n') + '\n');
  writeFileSync(join(dir, 'findings.jsonl'), findingsOut.join('\n') + (findingsOut.length ? '\n' : ''));
  process.stdout.write(`run: ${ran} PRs, ${errors} engine errors, ${findingsOut.length} findings -> results.csv, findings.jsonl\n`);
}

await main();
