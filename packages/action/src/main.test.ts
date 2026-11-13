import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mergeHistory, parseHistory, serializeHistory } from '@testwitness/core';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FIXTURE = resolve(__dirname, '../test-fixtures/pull_request.synchronize.json');
const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>';

const TEST_V1 = `import { describe, it, expect } from 'vitest';
import { round2 } from './money';
describe('round2', () => {
  it('rounds up', () => { expect(round2(1.005)).toBe(1.01); });
  it('keeps integers', () => { expect(round2(3)).toBe(3); });
  it('handles negatives', () => { expect(round2(-1.239)).toBe(-1.24); });
});
`;
const TEST_V2 = TEST_V1.replace("  it('keeps integers', () => { expect(round2(3)).toBe(3); });\n", '');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Maple Ridge', GIT_AUTHOR_EMAIL: 'maple@example.test', GIT_COMMITTER_NAME: 'Maple Ridge', GIT_COMMITTER_EMAIL: 'maple@example.test' },
  }).trim();
}

/** A repo whose head commit deletes one test. Returns the shas. */
function makeRepo(dir: string, withTrailer: boolean): { base: string; head: string } {
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/money.ts'), 'export const round2 = (n: number): number => Math.round(n * 100) / 100;\n');
  writeFileSync(join(dir, 'src/money.test.ts'), TEST_V1);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'src/money.test.ts'), TEST_V2);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `Speed up invoice rounding${withTrailer ? `\n\n${TRAILER}` : ''}`);
  return { base, head: git(dir, 'rev-parse', 'HEAD') };
}

function writePayload(path: string, shas: { base: string; head: string }, user: { login: string; type: string }, withMarker: boolean): void {
  const raw = readFileSync(FIXTURE, 'utf8').replaceAll('BASESHA_PLACEHOLDER', shas.base).replaceAll('HEADSHA_PLACEHOLDER', shas.head);
  const payload = JSON.parse(raw);
  payload.pull_request.user = { ...payload.pull_request.user, ...user };
  if (!withMarker) payload.pull_request.body = 'Rounds invoice totals once instead of per line.';
  writeFileSync(path, JSON.stringify(payload));
}

interface Outcome {
  markdown: string;
  json: { state: string; findings: unknown[]; provenance: { agents: Array<{ name: string; signals: string[] }>; botAuthor?: string } };
  exitCode: number | string | undefined;
}

async function runAction(opts: { trailer: boolean; marker: boolean; user: { login: string; type: string }; setup?: (dir: string, repo: string) => Record<string, string> }): Promise<Outcome & { files: Record<string, string> }> {
  const dir = mkdtempSync(join(tmpdir(), 'tw-action-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const shas = makeRepo(repo, opts.trailer);
  const eventPath = join(dir, 'event.json');
  writePayload(eventPath, shas, opts.user, opts.marker);
  Object.assign(process.env, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_WORKSPACE: repo,
    GITHUB_REPOSITORY: 'acme-widgets/ledger-core',
    INPUT_MODE: 'report',
    INPUT_COMMENT: 'true',
    INPUT_OUTPUT_DIR: '.',
    INPUT_JUNIT: '',
    INPUT_HISTORY: '',
    INPUT_HISTORY_ARTIFACT: 'testwitness-history',
    INPUT_HISTORY_WRITE: 'false',
    ...(opts.setup ? opts.setup(dir, repo) : {}),
  });
  process.exitCode = undefined;
  // @actions/github is an external dependency, so vi.resetModules does not reload it and its
  // context (built from GITHUB_EVENT_PATH at import) would be stale. Rebuild it from the env.
  vi.resetModules();
  const github = await import('@actions/github');
  const { Context } = await import('@actions/github/lib/context.js');
  Object.assign(github.context, new Context());
  const { run } = await import('./main.js');
  await run();
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  const markdown = readFileSync(join(repo, 'testwitness.md'), 'utf8');
  const json = JSON.parse(readFileSync(join(repo, 'testwitness.json'), 'utf8'));
  const files: Record<string, string> = {};
  if (existsSync(join(repo, 'testwitness-history.json'))) files['testwitness-history.json'] = readFileSync(join(repo, 'testwitness-history.json'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { markdown, json, exitCode, files };
}

const ENV_KEYS = ['GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'INPUT_MODE', 'INPUT_COMMENT', 'INPUT_OUTPUT_DIR', 'INPUT_JUNIT', 'INPUT_HISTORY', 'INPUT_HISTORY_ARTIFACT', 'INPUT_HISTORY_WRITE', 'INPUT_TOKEN', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT'];

describe('action provenance on a pull_request event payload', () => {
  let saved: Record<string, string | undefined>;
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ['INPUT_TOKEN', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) delete process.env[k];
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stdout.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('shows the agent name and signals from the commit trailer and PR marker', async () => {
    const out = await runAction({ trailer: true, marker: true, user: { login: 'maple-ridge-dev', type: 'User' } });
    expect(out.markdown).toContain('**Provenance**');
    expect(out.markdown).toMatch(/- Claude Code: .*Co-Authored-By trailer on 1 of 1 commit/);
    expect(out.markdown).toContain('Generated with Claude Code footer in PR text');
    expect(out.markdown).not.toContain('Bot author');
  });

  it('shows the Bot author line when the payload user is a Bot', async () => {
    const out = await runAction({ trailer: false, marker: false, user: { login: 'dependabot[bot]', type: 'Bot' } });
    expect(out.markdown).toContain('**Provenance**');
    expect(out.markdown).toContain('- Bot author: dependabot\\[bot\\]');
    expect(out.json.provenance.botAuthor).toBe('dependabot[bot]');
  });

  it('treats user.type Bot as a bot even for an unlisted login', async () => {
    const out = await runAction({ trailer: false, marker: false, user: { login: 'acme-helper', type: 'Bot' } });
    expect(out.json.provenance.botAuthor).toBe('acme-helper');
  });

  it('does not change findings, state or exit code', async () => {
    const without = await runAction({ trailer: false, marker: false, user: { login: 'maple-ridge-dev', type: 'User' } });
    const withAgent = await runAction({ trailer: true, marker: true, user: { login: 'dependabot[bot]', type: 'Bot' } });
    expect(without.json.provenance.agents).toEqual([]);
    expect(withAgent.json.provenance.agents.length).toBeGreaterThan(0);
    expect(without.json.findings.length).toBeGreaterThan(0);
    expect(withAgent.json.findings).toEqual(without.json.findings);
    expect(withAgent.json.state).toBe(without.json.state);
    expect(withAgent.exitCode).toBe(without.exitCode);
  });
});

describe('action run history', () => {
  let saved: Record<string, string | undefined>;
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ['INPUT_TOKEN', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) delete process.env[k];
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stdout.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const user = { login: 'maple-ridge-dev', type: 'User' };
  const JUNIT = '<testsuite name="round2"><testcase classname="src/money.test.ts" name="round2 › rounds up"/><testcase classname="src/money.test.ts" name="round2 › handles negatives"/></testsuite>';

  it('grades a deletion of a test that kept failing as hides failure from a local history file and writes the merged history', async () => {
    let earlier = mergeHistory(undefined, { id: '100', date: '2026-11-01' }, [{ key: 'money::round2 keeps integers', status: 'failed', reruns: 0 }]);
    earlier = mergeHistory(earlier, { id: '101', date: '2026-11-02' }, [{ key: 'money::round2 keeps integers', status: 'failed', reruns: 0 }]);
    const out = await runAction({
      trailer: false,
      marker: false,
      user,
      setup: (dir, repo) => {
        writeFileSync(join(dir, 'history.json'), serializeHistory(earlier));
        writeFileSync(join(repo, 'junit.xml'), JUNIT);
        return { INPUT_HISTORY: join(dir, 'history.json'), INPUT_JUNIT: 'junit.xml', GITHUB_RUN_ID: '102' };
      },
    });
    const r001 = (out.json.findings as Array<{ ruleId: string; severity: string; label?: string; message: string }>).find((f) => f.ruleId === 'R001');
    expect(r001).toMatchObject({ severity: 'high', label: 'hides failure' });
    expect(r001!.message).toMatch(/failed in 2 of the last 2 runs$/);
    expect(out.markdown).toMatch(/- History: 2 earlier runs, 1 test tracked, from .*history\.json; 1 finding graded by history/);
    const written = parseHistory(out.files['testwitness-history.json']!).doc!;
    expect(written.runs.map((r) => r.id)).toEqual(['100', '101', '102']);
    expect(written.tests['money::round2 keeps integers']).toBe('FF-');
    expect(written.tests['money::round2 rounds up']).toBe('--P');
  });

  it('reads no history and says so in the log only when there is no token', async () => {
    const out = await runAction({ trailer: false, marker: false, user });
    expect(out.json.history).toBeUndefined();
    expect(out.markdown).not.toContain('History:');
    const logged = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(logged).toContain('History: no token, so the testwitness-history artifact of main was not read.');
    expect(out.files['testwitness-history.json']).toBeUndefined();
  });
});
