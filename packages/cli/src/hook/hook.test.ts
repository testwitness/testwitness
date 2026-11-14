// The agent guard, end to end on recorded hook payloads (fixtures/hooks, one directory per agent): each payload goes
// to the hook as stdin and the answer is asserted in that agent's documented blocking format.
// The whole file runs with the network guard installed: any socket, DNS lookup or fetch fails the run.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitAction, parseEvent, patchPaths, type Agent } from './events.js';
import { realPathOf, runHook, type HookOptions, type HookResult } from './run.js';
import { stateFile } from './state.js';
import { makeRepo, MATH_TEST, MATH_TEST_WEAKENED, TMP, OTHER_TEST_FOCUSED, type TestRepo } from '../testing/repo.js';
import { installNetworkGuard } from '../testing/no-network.js';

const network = installNetworkGuard();
afterAll(() => {
  expect(network.attempts()).toEqual([]);
  network.restore();
});

// Every hook call starts git several times; Windows runners are slow at that.
vi.setConfig({ testTimeout: 30_000 });

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/hooks');
let repo: TestRepo;
let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(TMP, 'tw-hook-state-'));
});
afterEach(() => {
  repo?.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

/** A path as it appears inside a JSON string: Windows backslashes escaped, as an agent writes them. */
const jsonText = (s: string): string => JSON.stringify(s).slice(1, -1);

function payload(agent: Agent, name: string, edit: (text: string) => string = (t) => t): string {
  const text = readFileSync(join(fixtures, agent, name), 'utf8').replaceAll('__REPO__', jsonText(repo.dir));
  return edit(text);
}
const hook = (agent: Agent, name: string, extra: Partial<HookOptions> = {}): Promise<HookResult> => runHook({ agent, input: payload(agent, name), stateDir, ...extra });
const out = (r: HookResult): Record<string, unknown> => JSON.parse(r.stdout) as Record<string, unknown>;

/** The agent loosened one assertion and focused a test in another file: two high findings (A002, R005) and one medium (R003). */
function weaken(): void {
  repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
  repo.write('src/other.test.ts', OTHER_TEST_FOCUSED);
}

function expectReason(reason: string): void {
  // rule id, file and line
  expect(reason).toContain('A002 high src/math.test.ts:6');
  expect(reason).toContain('R005 high src/other.test.ts:3');
  // the base text to restore
  expect(reason).toContain('Base text to restore (src/math.test.ts at ');
  expect(reason).toContain('expect(add(1, 2)).toBe(3);');
  expect(reason).toContain("it('is true', () => {");
  // the one sentence
  expect(reason).toContain('Restore the base text, or keep the change and state why in the PR description so a maintainer can acknowledge it.');
  // medium is advice
  expect(reason).toContain('Advice, not blocking: R003 medium src/math.test.ts:9');
}

describe('recognising git commit and git push in a shell command', () => {
  it.each([
    ['git commit -m x', 'commit'],
    ['git add -A && git commit -m "x"', 'commit'],
    ['cd pkg; git -c user.name=a commit --amend', 'commit'],
    ['git --no-pager push origin main', 'push'],
    ['git commit -m x && git push', 'push'],
    ['(git push)', 'push'],
    ['FOO=1 git push --force', 'push'],
  ])('%s', (cmd, kind) => expect(gitAction(cmd)?.kind).toBe(kind));
  it.each(['npm test', 'git status', 'git log --grep commit', 'git commit-tree abc', 'digit commit', 'git stash push', 'legit push'])('%s is not one', (cmd) => expect(gitAction(cmd)).toBeUndefined());
  it('reads the directory of git -C', () => {
    expect(gitAction('git -C packages/app commit -m x')).toEqual({ kind: 'commit', dir: 'packages/app' });
    expect(gitAction('git -C "my dir" push')).toEqual({ kind: 'push', dir: 'my dir' });
  });
  it('reads the paths of an apply_patch body', () => {
    expect(patchPaths('*** Begin Patch\n*** Update File: a/b.test.ts\n*** Move to: a/c.test.ts\n*** Add File: d.py\n*** Delete File: e.java\n*** End Patch')).toEqual(['a/b.test.ts', 'a/c.test.ts', 'd.py', 'e.java']);
  });
});

describe('every fixture parses', () => {
  for (const agent of ['claude', 'cursor', 'codex', 'git'] as const) {
    for (const name of readdirSync(join(fixtures, agent))) {
      it(`${agent}/${name}`, () => {
        const e = parseEvent(agent, readFileSync(join(fixtures, agent, name), 'utf8'));
        expect(e.agent).toBe(agent);
        if (agent !== 'git') expect(e.sessionId).toBeTruthy();
        expect(e.kind).toBe(/commit/.test(name) ? 'commit' : /push/.test(name) ? 'push' : /aborted|npm-test|-ls/.test(name) ? 'other' : /stop/.test(name) ? 'stop' : 'edit');
      });
    }
  }
});

describe('Claude Code (fixtures/hooks/claude)', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('PreToolUse on git commit: denies with hookSpecificOutput and the finding, exit 0', async () => {
    weaken();
    const r = await hook('claude', 'pretooluse-bash-git-commit.json');
    expect(r.exitCode).toBe(0);
    const o = out(r) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
    expect(Object.keys(o)).toEqual(['hookSpecificOutput']);
    expect(o.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/^testwitness blocked this commit: 2 test integrity findings/);
    expectReason(o.hookSpecificOutput.permissionDecisionReason);
    expect(o.hookSpecificOutput.permissionDecisionReason.length).toBeLessThan(10_000);
  });

  it('PreToolUse on git push: denies', async () => {
    weaken();
    const o = out(await hook('claude', 'pretooluse-bash-git-push.json')) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/^testwitness blocked this push/);
  });

  it('Stop and SubagentStop: {"decision":"block","reason"}', async () => {
    weaken();
    for (const name of ['stop.json', 'subagent-stop.json']) {
      const r = await hook('claude', name, { stateDir: mkdtempSync(join(stateDir, 's-')) });
      expect(r.exitCode).toBe(0);
      const o = out(r) as { decision: string; reason: string };
      expect(Object.keys(o).sort()).toEqual(['decision', 'reason']);
      expect(o.decision).toBe('block');
      expect(o.reason).toMatch(/^testwitness blocked the end of this turn/);
      expectReason(o.reason);
    }
  });

  it('any other Bash command passes with no output and no check', async () => {
    weaken();
    const r = await hook('claude', 'pretooluse-bash-npm-test.json');
    expect(r).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
    expect(r.evaluation).toBeUndefined();
  });

  it('never prints permissionDecision allow, so the user keeps their own permission prompt', async () => {
    const r = await hook('claude', 'pretooluse-bash-git-commit.json');
    expect(r).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('editing a test file is not blocked by default, weakened tree or not', async () => {
    weaken();
    for (const name of ['pretooluse-edit.json', 'pretooluse-write.json']) expect(await hook('claude', name)).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('editing a path on the protect list of the base config is denied', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'protect:\n  - "src/math.test.ts"\n' });
    const o = out(await hook('claude', 'pretooluse-edit.json')) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(o.hookSpecificOutput.permissionDecisionReason).toContain('src/math.test.ts is on the protect list');
    // Another file in the same repository is still free to edit.
    const other = await runHook({ agent: 'claude', input: payload('claude', 'pretooluse-edit.json', (t) => t.replace('src/math.test.ts', 'src/other.test.ts')), stateDir });
    expect(other.stdout).toBe('');
  });

  it('a protect list written into the working tree protects nothing: the config comes from the base', async () => {
    repo.write('.testwitness.yml', 'protect:\n  - "src/**"\n');
    expect((await hook('claude', 'pretooluse-edit.json')).stdout).toBe('');
  });

  it('a changed protected path blocks the commit even when the edit went around the edit tools', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'protect:\n  - "src/other.test.ts"\n' });
    repo.write('src/other.test.ts', "import { expect, it } from 'vitest';\n\nit('is true', () => {\n  expect(1 + 1).toBe(2);\n  expect(2).toBe(2);\n});\n");
    const o = out(await hook('claude', 'pretooluse-bash-git-commit.json')) as { hookSpecificOutput: { permissionDecisionReason: string } };
    expect(o.hookSpecificOutput.permissionDecisionReason).toContain('protect high src/other.test.ts: src/other.test.ts is on the protect list of .testwitness.yml and was modified');
  });
});

describe('Cursor (fixtures/hooks/cursor)', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('beforeShellExecution on git commit: {"permission":"deny"} with a user and an agent message', async () => {
    weaken();
    const r = await hook('cursor', 'before-shell-execution-git-commit.json');
    expect(r.exitCode).toBe(0);
    const o = out(r) as { permission: string; user_message: string; agent_message: string };
    expect(Object.keys(o).sort()).toEqual(['agent_message', 'permission', 'user_message']);
    expect(o.permission).toBe('deny');
    expect(o.user_message).toMatch(/^testwitness blocked this commit: 2 test integrity findings/);
    expect(o.user_message).not.toContain('\n');
    expectReason(o.agent_message);
  });

  it('allows with valid JSON, because Cursor blocks on invalid output of a permission hook', async () => {
    expect(out(await hook('cursor', 'before-shell-execution-ls.json'))).toEqual({ permission: 'allow' });
    expect(out(await hook('cursor', 'before-shell-execution-git-commit.json'))).toEqual({ permission: 'allow' });
    expect(out(await hook('cursor', 'pre-tool-use-write.json'))).toEqual({ permission: 'allow' });
  });

  it('stop and subagentStop: {"followup_message"} keeps the agent going; {} lets it stop', async () => {
    expect(out(await hook('cursor', 'stop.json'))).toEqual({});
    weaken();
    for (const name of ['stop.json', 'subagent-stop.json']) {
      const o = out(await hook('cursor', name, { stateDir: mkdtempSync(join(stateDir, 's-')) })) as { followup_message: string };
      expect(Object.keys(o)).toEqual(['followup_message']);
      expectReason(o.followup_message);
    }
  });

  it('an aborted turn is left alone', async () => {
    weaken();
    expect(out(await hook('cursor', 'stop-aborted.json'))).toEqual({});
  });

  it('preToolUse on a protected path: deny', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'protect: ["src/*.test.ts"]\n' });
    const o = out(await hook('cursor', 'pre-tool-use-write.json')) as { permission: string; agent_message: string };
    expect(o.permission).toBe('deny');
    expect(o.agent_message).toContain('protect list');
  });
});

describe('Codex (fixtures/hooks/codex)', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('PreToolUse on git commit: hookSpecificOutput deny', async () => {
    weaken();
    const r = await hook('codex', 'pretooluse-bash-git-commit.json');
    expect(r.exitCode).toBe(0);
    const o = out(r) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
    expect(Object.keys(o)).toEqual(['hookSpecificOutput']);
    expect(o.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expectReason(o.hookSpecificOutput.permissionDecisionReason);
  });

  it('Stop: {"decision":"block","reason"}; a clean tree prints nothing (plain text is invalid for Stop)', async () => {
    expect((await hook('codex', 'stop.json')).stdout).toBe('');
    weaken();
    const o = out(await hook('codex', 'stop.json')) as { decision: string; reason: string };
    expect(o.decision).toBe('block');
    expectReason(o.reason);
  });

  it('apply_patch is not blocked by default, and is denied on a protected path', async () => {
    expect((await hook('codex', 'pretooluse-apply-patch.json')).stdout).toBe('');
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'protect: ["src/math.test.ts"]\n' });
    const o = out(await hook('codex', 'pretooluse-apply-patch.json')) as { hookSpecificOutput: { permissionDecision: string } };
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('git pre-push (fixtures/hooks/git)', () => {
  beforeEach(() => {
    repo = makeRepo();
  });
  const push = (extra: Partial<HookOptions> = {}): Promise<HookResult> =>
    runHook({ agent: 'git', input: readFileSync(join(fixtures, 'git/pre-push.txt'), 'utf8').replace('__LOCAL_SHA__', repo.git('rev-parse', 'HEAD').trim()), cwd: repo.dir, stateDir, ...extra });

  it('refuses the push with exit 1 and the findings on stderr, every time (no loop guard)', async () => {
    weaken();
    repo.git('checkout', '-q', '-b', 'work');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'weaken');
    for (let i = 0; i < 3; i++) {
      const r = await push();
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^testwitness blocked this push: 2 test integrity findings/);
      expectReason(r.stderr);
    }
  });

  it('lets a clean push and a branch deletion through', async () => {
    expect(await push()).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
    const del = await runHook({ agent: 'git', input: '(delete) 0000000000000000000000000000000000000000 refs/heads/gone 1111111111111111111111111111111111111111\n', cwd: repo.dir, stateDir });
    expect(del).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  });
});

describe('what blocks', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('a clean tree, and a tree with only a medium finding, pass; the medium finding is shown as advice', async () => {
    expect(await hook('claude', 'stop.json')).toMatchObject({ stdout: '', stderr: '' });
    repo.write('src/math.test.ts', MATH_TEST.replace("it('handles negatives'", "it.skip('handles negatives'"));
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(false);
    expect(out(r)).toEqual({ systemMessage: 'testwitness: 1 finding shown as advice, not blocking: R003 medium src/math.test.ts:9.' });
  });

  it('fail_on: medium with the rule on hook.blocking makes the medium finding block', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'fail_on: medium\nhook:\n  blocking: [R003]\n' });
    repo.write('src/math.test.ts', MATH_TEST.replace("it('handles negatives'", "it.skip('handles negatives'"));
    const o = out(await hook('claude', 'stop.json')) as { decision: string; reason: string };
    expect(o.decision).toBe('block');
    expect(o.reason).toContain('R003 medium src/math.test.ts:9');
  });

  it('the working tree cannot relax the check: an edited .testwitness.yml is ignored and is itself a blocking W006', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'mode: report\n' });
    weaken();
    repo.write('.testwitness.yml', 'rules:\n  A002: off\n  R005: off\n  W006: off\nacknowledge: []\nhook:\n  advice_only: [A002, R005, W006]\n');
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(true);
    expect(r.evaluation!.blocking.map((f) => f.ruleId).sort()).toEqual(['A002', 'R005', 'W006']);
    expect(r.decision.reason).toContain('W006 high .testwitness.yml');
  });

  it('a .testwitness.yml the change adds is advice (no gate existed at the base), and still has no effect', async () => {
    weaken();
    repo.write('.testwitness.yml', 'rules:\n  A002: off\n  R005: off\n');
    const r = await hook('claude', 'stop.json');
    expect(r.evaluation!.blocking.map((f) => f.ruleId).sort()).toEqual(['A002', 'R005']);
    expect(r.evaluation!.advice.map((f) => f.ruleId)).toContain('W006');
  });

  it('a finding acknowledged in the base config does not block', async () => {
    repo.dispose();
    repo = makeRepo();
    weaken();
    const first = await hook('claude', 'stop.json', { stateDir: mkdtempSync(join(stateDir, 's-')) });
    const acks = first.evaluation!.blocking.map((f) => `  - fingerprint: "${f.fingerprint}"\n    reason: intended\n`).join('');
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': `acknowledge:\n${acks}` });
    weaken();
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(false);
  });

  it('only the proven rules block by default (docs/precision.md); an opted in rule on hook.blocking blocks; hook.advice_only narrows the list', async () => {
    const edit = (): void => {
      // R001 at high: a test deleted while the production file it exercises changes. R002: a test file deleted.
      repo.write('src/math.ts', 'export const add = (a: number, b: number) => a + b + 0;\n');
      repo.write('src/math.test.ts', MATH_TEST.replace(/\n {2}it\('handles negatives'[\s\S]*?\n {2}\}\);\n/, '\n'));
      repo.remove('src/other.test.ts');
    };
    edit();
    // R001 and R002 are not proven yet: capped at low, so they neither block nor show as advice.
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(false);
    expect(r.evaluation!.advice).toEqual([]);
    // On the blocking list but not opted in: still capped, still no block.
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'hook:\n  blocking: [A002, R003, R004, R005, W006, R001, R002]\n' });
    edit();
    expect((await hook('claude', 'stop.json')).decision.block).toBe(false);
    // Opted in with a severity and on the blocking list: they block.
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'rules:\n  R001: medium\n  R002: high\nhook:\n  blocking: [A002, R003, R004, R005, W006, R001, R002]\n' });
    edit();
    const wide = await hook('claude', 'stop.json');
    expect(wide.decision.block).toBe(true);
    expect(wide.decision.reason).toContain("it('handles negatives', () => {");
    expect(wide.decision.reason).toContain('R002 high src/other.test.ts');
    expect(wide.decision.reason).toContain('the whole file: git show');
    // Opted in but not on the blocking list: advice at its own severity.
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'rules:\n  R001: medium\n  R002: high\n' });
    edit();
    const advised = await hook('claude', 'stop.json');
    expect(advised.decision.block).toBe(false);
    expect(advised.evaluation!.advice.map((f) => `${f.ruleId} ${f.severity}`).sort()).toEqual(['R001 high', 'R002 high']);
    expect(advised.decision.note).toContain('R001 high src/math.test.ts');
    // advice_only takes a rule off the list again: A002 is on the default list, and here it only advises.
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'hook:\n  advice_only: [A002]\n' });
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const narrow = await hook('claude', 'stop.json');
    expect(narrow.decision.block).toBe(false);
    expect(narrow.evaluation!.advice.map((f) => f.ruleId).sort()).toEqual(['A002', 'R003']);
  });

  it('fail_on: medium lowers the threshold: a newly skipped test (R003, medium) blocks; a capped rule stays out', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'fail_on: medium\n' });
    repo.write('src/math.test.ts', MATH_TEST.replace("it('handles negatives'", "it.skip('handles negatives'"));
    repo.remove('src/other.test.ts');
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(true);
    expect(r.evaluation!.blocking.map((f) => `${f.ruleId} ${f.severity}`)).toEqual(['R003 medium']);
    expect(r.evaluation!.advice).toEqual([]);
  });
});

describe('loop guard', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('the same finding blocks twice in a session, then the hook allows with a visible note', async () => {
    weaken();
    const before = repo.state();
    const a = await hook('claude', 'stop.json');
    const b = await hook('claude', 'pretooluse-bash-git-commit.json'); // same session, another event: the count is per finding
    const c = await hook('claude', 'stop.json');
    expect([a.decision.block, b.decision.block, c.decision.block]).toEqual([true, true, false]);
    expect(a.decision.reason).toContain('Block 1 of 2 for this finding in this session.');
    expect(b.decision.reason).toContain('Block 2 of 2 for this finding in this session.');
    expect(out(c)).toEqual({
      systemMessage:
        'testwitness: the guard stepped aside: 2 findings were blocked 2 times in this session and are still open (A002 src/math.test.ts:6, R005 src/other.test.ts:3). It stops blocking so the agent is not stuck; review them before you merge. 1 finding shown as advice, not blocking: R003 medium src/math.test.ts:9.',
    });
    expect(c.stderr).toContain('the guard stepped aside');
    // The state lives under the temp dir, keyed by repository and session, and the repository is untouched.
    expect(existsSync(stateFile(stateDir, repo.dir, 'abc123'))).toBe(true);
    expect(repo.state()).toBe(before);
  });

  it('a new finding still blocks after the guard stepped aside for older ones', async () => {
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    await hook('claude', 'stop.json');
    await hook('claude', 'stop.json');
    expect((await hook('claude', 'stop.json')).decision.block).toBe(false);
    repo.write('src/other.test.ts', OTHER_TEST_FOCUSED);
    const r = await hook('claude', 'stop.json');
    expect(r.decision.block).toBe(true);
    expect(r.decision.reason).toMatch(/^testwitness blocked the end of this turn: 1 test integrity finding in/);
    expect(r.decision.reason).toContain('R005 high src/other.test.ts:3');
    expect(r.decision.reason).toContain('1 other finding is still open and no longer blocking.');
  });

  it('another session starts from zero, and so does another repository', async () => {
    weaken();
    await hook('claude', 'stop.json');
    await hook('claude', 'stop.json');
    expect((await hook('claude', 'stop.json')).decision.block).toBe(false);
    const other = await runHook({ agent: 'claude', input: payload('claude', 'stop.json', (t) => t.replace('"abc123"', '"another-session"')), stateDir });
    expect(other.decision.block).toBe(true);
    expect(stateFile(stateDir, repo.dir, 'abc123')).not.toBe(stateFile(stateDir, `${repo.dir}-x`, 'abc123'));
  });

  it('hook.max_blocks from the base config changes the cap', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'hook:\n  max_blocks: 1\n' });
    weaken();
    expect((await hook('claude', 'stop.json')).decision.block).toBe(true);
    expect((await hook('claude', 'stop.json')).decision.block).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('when the state cannot be written nothing blocks, and the note says so', async () => {
    weaken();
    chmodSync(stateDir, 0o500);
    try {
      const r = await hook('claude', 'stop.json');
      expect(r.decision.block).toBe(false);
      expect(r.decision.note).toContain('the loop guard could not write its state');
    } finally {
      chmodSync(stateDir, 0o700);
    }
  });

  it('when the state directory is not a directory nothing blocks', async () => {
    weaken();
    const r = await hook('claude', 'stop.json', { stateDir: join(repo.dir, 'src/math.ts') });
    expect(r.decision.block).toBe(false);
    expect(r.decision.note).toContain('the loop guard could not write its state');
  });
});

describe('a hook that fails allows the action and says so', () => {
  beforeEach(() => {
    repo = makeRepo();
    weaken();
  });

  it('a crash in the check', async () => {
    const r = await hook('claude', 'stop.json', { beforeCheck: () => Promise.reject(new Error('boom')) });
    expect(r.exitCode).toBe(0);
    expect(out(r)).toEqual({ systemMessage: 'testwitness: the hook crashed (boom); the action was allowed without a check.' });
    const c = await hook('cursor', 'before-shell-execution-git-commit.json', { beforeCheck: () => Promise.reject(new Error('boom')) });
    expect(out(c)).toEqual({ permission: 'allow', user_message: 'testwitness: the hook crashed (boom); the action was allowed without a check.' });
  });

  it('a timeout, from the flag and from hook.timeout in the base config', async () => {
    const slow = (): Promise<void> => new Promise((done) => setTimeout(done, 1500));
    const t0 = Date.now();
    const r = await hook('claude', 'stop.json', { timeoutSeconds: 0.2, beforeCheck: slow });
    expect(Date.now() - t0).toBeLessThan(1400);
    expect(r.decision.block).toBe(false);
    expect(out(r)).toEqual({ systemMessage: 'testwitness: the hook timed out after 0.2 s; the action was allowed without a check. Run testwitness check --worktree to see the findings.' });
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'hook:\n  timeout: 0.3\n' });
    weaken();
    const viaConfig = await hook('codex', 'stop.json', { beforeCheck: slow });
    expect(viaConfig.decision.note).toContain('timed out after 0.3 s');
    const git = await runHook({ agent: 'git', input: `refs/heads/main ${repo.git('rev-parse', 'HEAD').trim()} refs/heads/main ${'0'.repeat(40)}\n`, cwd: repo.dir, timeoutSeconds: 0.2, beforeCheck: slow });
    expect(git).toMatchObject({ exitCode: 0, stdout: '' });
    expect(git.stderr).toContain('timed out');
  });

  it('stdin that is not the agent’s JSON', async () => {
    for (const input of ['', 'not json', '[]']) {
      const r = await runHook({ agent: 'claude', input, cwd: repo.dir, stateDir });
      expect(r.exitCode).toBe(0);
      expect(r.decision.block).toBe(false);
      expect(r.decision.note).toContain('could not read the claude event');
    }
    const cut = await runHook({ agent: 'cursor', input: '{"hook_event_name":"beforeShellExecution","command":"git comm', cwd: repo.dir, stateDir });
    const o = JSON.parse(cut.stdout) as { permission: string; user_message: string };
    expect(o.permission).toBe('allow');
    expect(o.user_message).toMatch(/^testwitness: the hook could not read the cursor event \(.*\); the action was allowed without a check\.$/);
  });

  it('a broken base config, an unknown base ref and a directory that is not a repository', async () => {
    repo.dispose();
    repo = makeRepo({ '.testwitness.yml': 'fail_on: maybe\n' });
    weaken();
    const bad = await hook('claude', 'stop.json');
    expect(bad.decision).toEqual({ block: false, note: 'the hook could not run the check (fail_on must be high, medium or low); the action was allowed without a check.' });
    const noBase = await hook('claude', 'stop.json', { base: 'no-such-branch' });
    expect(noBase.decision.block).toBe(false);
    expect(noBase.decision.note).toContain('the hook could not run the check');
    const outside = mkdtempSync(join(TMP, 'tw-not-a-repo-'));
    try {
      const r = await runHook({ agent: 'claude', input: payload('claude', 'stop.json').replaceAll(repo.dir, outside), stateDir });
      expect(r).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('protect list through a symbolic link', () => {
  it('denies an edit named through a linked path to the repository', async () => {
    repo = makeRepo({ '.testwitness.yml': 'protect:\n  - "src/math.test.ts"\n' });
    const link = join(stateDir, 'linked-repo');
    symlinkSync(repo.dir, link, process.platform === 'win32' ? 'junction' : 'dir');
    const input = payload('claude', 'pretooluse-edit.json').replaceAll(jsonText(repo.dir), jsonText(link));
    const o = out(await runHook({ agent: 'claude', input, stateDir })) as { hookSpecificOutput: { permissionDecision: string } };
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('realPathOf resolves the nearest existing ancestor of a file that does not exist yet', () => {
    const link = join(stateDir, 'linked');
    mkdirSync(join(stateDir, 'real'));
    symlinkSync(join(stateDir, 'real'), link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(realPathOf(join(link, 'new', 'file.ts'))).toBe(join(realpathSync.native(stateDir), 'real', 'new', 'file.ts'));
  });
});

describe('the repository path as an agent writes it into the event', () => {
  beforeEach(() => {
    repo = makeRepo();
  });

  it('a Windows path arrives escaped in the JSON and is read back exactly', async () => {
    const { parseEvent } = await import('./events.js');
    const cwd = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\tw-repo-abc';
    const text = payload('claude', 'stop.json').replaceAll(jsonText(repo.dir), jsonText(cwd));
    expect(parseEvent('claude', text).cwd).toBe(cwd);
  });

  it('the end of the turn is blocked when the event names the repository with this platform\'s own path text', async () => {
    weaken();
    const input = JSON.stringify({ ...JSON.parse(payload('claude', 'stop.json')), cwd: repo.dir });
    const r = await runHook({ agent: 'claude', input, stateDir });
    expect(r.decision.block).toBe(true);
  });
});
