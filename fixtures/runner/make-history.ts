/**
 * Produce the history/history.json of golden cases by running the real CLI, never by hand.
 *
 * A case opts in with history/runs.json:
 *   { "runs": [ { "id": "history-1", "junit": ["../../../junit/junit.xml"] }, ... ] }
 * where each junit entry is a path or glob relative to the history directory, pointing at real JUnit XML that a test
 * framework wrote. For every run, in order, this script calls the bundled CLI
 *   testwitness check --base HEAD --head HEAD --junit <files> --run-id <id> --history <previous> --history-out <next>
 * in an empty temporary git repository, so the engine merges that run into the history exactly as it does in CI.
 * The final document is written to history/history.json.
 *
 * Usage (after pnpm bundle:cli):
 *   pnpm exec tsx fixtures/runner/make-history.ts                 every case with history/runs.json
 *   pnpm exec tsx fixtures/runner/make-history.ts <case dir> ...  only these cases
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(fixtures, '..');
const cli = join(root, 'packages/cli/bin/testwitness.js');
if (!existsSync(join(root, 'packages/cli/dist/cli.js'))) throw new Error('run pnpm bundle:cli first');

interface RunsSpec {
  runs: Array<{ id: string; junit: string[] }>;
}

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@testwitness.local', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@testwitness.local' };
delete ENV['GITHUB_RUN_ID'];
delete ENV['GITHUB_RUN_ATTEMPT'];

function casesWithRuns(): string[] {
  const out: string[] = [];
  for (const project of readdirSync(fixtures)) {
    const cases = join(fixtures, project, 'cases');
    if (!existsSync(cases) || !statSync(cases).isDirectory()) continue;
    for (const c of readdirSync(cases).sort()) if (existsSync(join(cases, c, 'history', 'runs.json'))) out.push(join(cases, c));
  }
  return out;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2).map((p) => resolve(p)) : casesWithRuns();
for (const caseDir of targets) {
  const historyDir = join(caseDir, 'history');
  const spec = JSON.parse(readFileSync(join(historyDir, 'runs.json'), 'utf8')) as RunsSpec;
  const repo = mkdtempSync(join(tmpdir(), 'tw-make-history-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: ENV });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'empty'], { cwd: repo, env: ENV });
    spec.runs.forEach((run, i) => {
      const junit = run.junit.map((p) => resolve(historyDir, p)).join(',');
      const args = ['check', '--cwd', repo, '--base', 'HEAD', '--head', 'HEAD', '--junit', junit, '--format', 'json', '--out', 'report.json', '--run-id', run.id, '--history-out', 'history.json', '--quiet'];
      if (i > 0) args.push('--history', 'history.json');
      execFileSync(process.execPath, [cli, ...args], { cwd: repo, env: ENV, stdio: ['ignore', 'ignore', 'inherit'] });
    });
    copyFileSync(join(repo, 'history.json'), join(historyDir, 'history.json'));
    const doc = JSON.parse(readFileSync(join(historyDir, 'history.json'), 'utf8')) as { runs: unknown[]; tests: Record<string, string> };
    process.stdout.write(`${relative(root, historyDir)}/history.json: ${doc.runs.length} runs, ${Object.keys(doc.tests).length} tests\n`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}
