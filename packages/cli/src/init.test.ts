// `testwitness init --agent <name>`: writes the hook config only, merges without clobbering, prints what it wrote, and
// is idempotent. Also the Claude Code plugin directory, which must stay equal to what init writes.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_VERSION } from '@testwitness/core';
import { baseCommand, hookGroups, init, isTestwitnessHook, prePushScript } from './init.js';
import { runHook } from './hook/run.js';
import { makeRepo, MATH_TEST_WEAKENED, TMP, type TestRepo } from './testing/repo.js';

const here = dirname(fileURLToPath(import.meta.url));
let repo: TestRepo;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => repo.dispose());

const read = (rel: string): string => readFileSync(join(realpathSync.native(repo.dir), rel), 'utf8');
const json = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>;
const run = (agent: 'claude' | 'cursor' | 'codex' | 'git', extra: { force?: boolean; command?: string } = {}) => init({ agent, cwd: repo.dir, command: 'testwitness', ...extra });

describe('init --agent claude', () => {
  it('creates .claude/settings.json with the hooks block and nothing else in the repository', async () => {
    const before = repo.git('status', '--porcelain=v1', '-uall');
    const r = await run('claude');
    expect(r.exitCode).toBe(0);
    expect(r.files).toEqual([{ path: join(realpathSync.native(repo.dir), '.claude/settings.json'), action: 'created' }]);
    expect(r.lines[0]).toBe('created .claude/settings.json: hooks PreToolUse (Bash and the edit tools), Stop and SubagentStop run `testwitness hook --agent claude`');
    expect(before).toBe('');
    expect(repo.git('status', '--porcelain=v1', '-uall')).toBe('?? .claude/settings.json\n');
    const handler = { type: 'command', command: 'testwitness hook --agent claude', timeout: 30 };
    expect(json('.claude/settings.json')).toEqual({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [handler] }],
        Stop: [{ hooks: [handler] }],
        SubagentStop: [{ hooks: [handler] }],
      },
    });
  });

  it('is idempotent: the second run changes no byte and says so', async () => {
    await run('claude');
    const first = read('.claude/settings.json');
    const mtime = statSync(join(realpathSync.native(repo.dir), '.claude/settings.json')).mtimeMs;
    const r = await run('claude');
    expect(r.files[0]!.action).toBe('unchanged');
    expect(r.lines[0]).toBe('unchanged .claude/settings.json (already set up)');
    expect(read('.claude/settings.json')).toBe(first);
    expect(statSync(join(realpathSync.native(repo.dir), '.claude/settings.json')).mtimeMs).toBe(mtime);
  });

  it('merges into an existing file without clobbering other keys or other hooks', async () => {
    const existing = {
      permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(./.env)'] },
      env: { FOO: 'bar' },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/block-rm.sh' }] }],
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
      },
    };
    repo.write('.claude/settings.json', JSON.stringify(existing, null, 4));
    const r = await run('claude');
    expect(r.files[0]!.action).toBe('updated');
    const doc = json('.claude/settings.json') as typeof existing & { hooks: Record<string, unknown[]> };
    expect(doc.permissions).toEqual(existing.permissions);
    expect(doc.env).toEqual(existing.env);
    expect(doc.hooks['PostToolUse']).toEqual(existing.hooks.PostToolUse);
    expect(doc.hooks['PreToolUse']).toHaveLength(2);
    expect(doc.hooks['PreToolUse']![0]).toEqual(existing.hooks.PreToolUse[0]);
    expect(Object.keys(doc.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'Stop', 'SubagentStop']);
    expect((await run('claude')).files[0]!.action).toBe('unchanged');
  });

  it('replaces its own older handler in place when the command changes, leaving a neighbour in the same group alone', async () => {
    await run('claude', { command: 'npx --no-install testwitness' });
    const doc = json('.claude/settings.json') as { hooks: { Stop: Array<{ hooks: unknown[] }> } };
    doc.hooks.Stop[0]!.hooks.push({ type: 'command', command: './notify.sh' });
    repo.write('.claude/settings.json', JSON.stringify(doc, null, 2) + '\n');
    await run('claude');
    const after = json('.claude/settings.json') as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    expect(after.hooks['Stop']).toEqual([{ hooks: [{ type: 'command', command: 'testwitness hook --agent claude', timeout: 30 }, { type: 'command', command: './notify.sh' }] }]);
    expect(after.hooks['PreToolUse']).toHaveLength(1);
    expect(JSON.stringify(after)).not.toContain('npx');
  });

  it('refuses to touch a file that is not valid JSON, or whose hooks are not the documented shape', async () => {
    repo.write('.claude/settings.json', '{ "permissions": {,} }');
    const bad = await run('claude');
    expect(bad.exitCode).toBe(2);
    expect(bad.lines.at(-1)).toContain('is not valid JSON');
    expect(read('.claude/settings.json')).toBe('{ "permissions": {,} }');
    repo.write('.claude/settings.json', '{ "hooks": [] }');
    expect((await run('claude')).exitCode).toBe(2);
    repo.write('.claude/settings.json', '{ "hooks": { "Stop": {} } }');
    expect((await run('claude')).exitCode).toBe(2);
    expect(read('.claude/settings.json')).toBe('{ "hooks": { "Stop": {} } }');
  });

  it('on a branch, the fresh hook config is advice to the hook it installs, not a block; removing an installed hook blocks', async () => {
    const state = mkdtempSync(join(TMP, 'tw-init-state-'));
    const stop = (): Promise<Awaited<ReturnType<typeof runHook>>> => runHook({ agent: 'claude', input: JSON.stringify({ session_id: 's1', cwd: repo.dir, hook_event_name: 'Stop', stop_hook_active: false }), stateDir: state });
    try {
      // A settings file without our hook is on main; init adds the hook on a branch.
      repo.write('.claude/settings.json', '{ "env": { "FOO": "bar" } }\n');
      repo.git('add', '-A');
      repo.git('commit', '-q', '-m', 'settings');
      await run('claude');
      const fresh = await stop();
      expect(fresh.decision.block).toBe(false);
      expect(fresh.evaluation!.advice.map((f) => `${f.ruleId} ${f.path}`)).toEqual(['W006 .claude/settings.json']);
      // Once the hook is on main, taking it out is a blocking finding.
      repo.git('add', '-A');
      repo.git('commit', '-q', '-m', 'install guard');
      repo.write('.claude/settings.json', '{ "env": { "FOO": "bar" }, "disableAllHooks": true }\n');
      const removed = await stop();
      expect(removed.decision.block).toBe(true);
      expect(removed.decision.reason).toContain('W006 high .claude/settings.json: .claude/settings.json was modified; it holds the testwitness agent hook config');
      expect(removed.decision.reason).toContain('"command": "testwitness hook --agent claude"');
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});

describe('init --agent cursor and codex', () => {
  it('cursor: .cursor/hooks.json with version 1, merged and idempotent', async () => {
    repo.write('.cursor/hooks.json', JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }], stop: [{ command: './notify.sh' }] } }));
    const r = await run('cursor');
    expect(r.lines[0]).toBe('updated .cursor/hooks.json: hooks beforeShellExecution, preToolUse (file tools), stop and subagentStop run `testwitness hook --agent cursor`');
    const ours = { command: 'testwitness hook --agent cursor', timeout: 30 };
    expect(json('.cursor/hooks.json')).toEqual({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: './format.sh' }],
        stop: [{ command: './notify.sh' }, ours],
        beforeShellExecution: [ours],
        preToolUse: [{ ...ours, matcher: 'Write|Edit|Delete' }],
        subagentStop: [ours],
      },
    });
    expect((await run('cursor')).files[0]!.action).toBe('unchanged');
    rmSync(join(realpathSync.native(repo.dir), '.cursor'), { recursive: true });
    expect((await run('cursor')).files[0]!.action).toBe('created');
    expect(json('.cursor/hooks.json')['version']).toBe(1);
  });

  it('codex: .codex/hooks.json, and the output says the hook must be trusted', async () => {
    const r = await run('codex');
    expect(r.lines).toEqual([
      'created .codex/hooks.json: hooks PreToolUse (Bash and apply_patch) and Stop run `testwitness hook --agent codex`',
      'Codex runs a project hook only after you have reviewed and trusted it: open Codex in this repository and run /hooks. A changed hook must be trusted again.',
    ]);
    const handler = { type: 'command', command: 'testwitness hook --agent codex', timeout: 30 };
    expect(json('.codex/hooks.json')).toEqual({ hooks: { PreToolUse: [{ matcher: '^(Bash|apply_patch)$', hooks: [handler] }], Stop: [{ hooks: [handler] }] } });
    expect((await run('codex')).files[0]!.action).toBe('unchanged');
  });
});

describe('init --agent git', () => {
  const hookPath = (): string => join(realpathSync.native(repo.dir), '.git/hooks/pre-push');

  it('installs an executable pre-push hook in the git directory, idempotently, and leaves the working tree alone', async () => {
    const r = await run('git');
    expect(r.exitCode).toBe(0);
    expect(r.lines[0]).toBe('created .git/hooks/pre-push: git runs `testwitness hook --agent git` before every push');
    expect(read('.git/hooks/pre-push')).toBe(prePushScript('testwitness'));
    expect(read('.git/hooks/pre-push')).toContain('exec testwitness hook --agent git\n');
    if (process.platform !== 'win32') expect(statSync(hookPath()).mode & 0o111).toBe(0o111);
    expect(repo.git('status', '--porcelain=v1', '-uall')).toBe('');
    expect((await run('git')).files[0]!.action).toBe('unchanged');
  });

  it('refuses to overwrite a different hook unless --force', async () => {
    mkdirSync(dirname(hookPath()), { recursive: true });
    writeFileSync(hookPath(), '#!/bin/sh\nnpm test\n');
    chmodSync(hookPath(), 0o755);
    const r = await run('git');
    expect(r.exitCode).toBe(1);
    expect(r.files[0]!.action).toBe('refused');
    expect(r.lines.join('\n')).toContain('a different pre-push hook is already there');
    expect(read('.git/hooks/pre-push')).toBe('#!/bin/sh\nnpm test\n');
    const forced = await run('git', { force: true });
    expect(forced.exitCode).toBe(0);
    expect(forced.files[0]!.action).toBe('updated');
    expect(read('.git/hooks/pre-push')).toBe(prePushScript('testwitness'));
  });

  it('follows core.hooksPath, and needs a git repository', async () => {
    repo.git('config', 'core.hooksPath', '.githooks');
    const r = await run('git');
    expect(r.files[0]!.path).toBe(join(realpathSync.native(repo.dir), '.githooks/pre-push'));
    expect(existsSync(hookPath())).toBe(false);
    const outside = mkdtempSync(join(TMP, 'tw-init-none-'));
    try {
      const none = await init({ agent: 'git', cwd: outside, command: 'testwitness' });
      expect(none.exitCode).toBe(2);
      expect(none.lines.at(-1)).toContain('is not inside a git repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('how the hook starts testwitness', () => {
  it('uses testwitness when it is on PATH, else npx --no-install (never a download)', async () => {
    const bin = mkdtempSync(join(TMP, 'tw-init-bin-'));
    try {
      expect(baseCommand({ pathEnv: bin })).toBe('npx --no-install testwitness');
      writeFileSync(join(bin, process.platform === 'win32' ? 'testwitness.cmd' : 'testwitness'), '');
      expect(baseCommand({ pathEnv: bin })).toBe('testwitness');
      expect(baseCommand({ pathEnv: bin, command: 'node /opt/tw/bin/testwitness.js' })).toBe('node /opt/tw/bin/testwitness.js');
      const r = await init({ agent: 'codex', cwd: repo.dir, pathEnv: mkdtempSync(join(bin, 'empty-')) });
      expect(read('.codex/hooks.json')).toContain('npx --no-install testwitness hook --agent codex');
      expect(r.lines.at(-1)).toContain('testwitness is not on your PATH');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('recognises its own handler in every form it writes, and nothing else', () => {
    for (const c of ['testwitness hook --agent claude', 'npx --no-install testwitness hook --agent cursor', 'node "/x/bin/testwitness.js" hook --agent codex']) expect(isTestwitnessHook(c), c).toBe(true);
    for (const c of ['testwitness check', 'npx testwitness mcp', './hook testwitness', undefined, 7]) expect(isTestwitnessHook(c)).toBe(false);
  });
});

describe('the Claude Code plugin (packages/cli/plugin)', () => {
  const plugin = join(here, '../plugin');
  const load = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(plugin, rel), 'utf8')) as Record<string, unknown>;

  it('has the manifest, the hooks file and the MCP file where the plugin reference puts them', () => {
    for (const rel of ['.claude-plugin/plugin.json', 'hooks/hooks.json', '.mcp.json', 'README.md']) expect(existsSync(join(plugin, rel)), rel).toBe(true);
    const manifest = load('.claude-plugin/plugin.json');
    expect(manifest['name']).toBe('testwitness');
    expect(manifest['name']).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    expect(manifest['version']).toBe(TOOL_VERSION);
    expect(() => new URL(String(manifest['homepage']))).not.toThrow();
    expect(manifest['license']).toBe('Apache-2.0');
  });

  it('bundles the same hooks init writes, wrapped in a top level "hooks" key', () => {
    const hooks = load('hooks/hooks.json');
    expect(Object.keys(hooks).sort()).toEqual(['description', 'hooks']);
    expect(hooks['hooks']).toEqual(hookGroups('claude', 'npx --no-install testwitness'));
  });

  it('bundles the MCP server, started without a download', () => {
    expect(load('.mcp.json')).toEqual({ mcpServers: { testwitness: { command: 'npx', args: ['--no-install', 'testwitness', 'mcp'] } } });
  });

  it('ships in the npm package', () => {
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('plugin');
  });
});

describe('init leaves a weakened tree to the hook', () => {
  it('a hook written by init for another agent does not hide findings', async () => {
    await run('cursor');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const state = mkdtempSync(join(TMP, 'tw-init-state-'));
    try {
      const r = await runHook({ agent: 'cursor', input: JSON.stringify({ conversation_id: 'c1', hook_event_name: 'stop', status: 'completed', loop_count: 0, workspace_roots: [repo.dir] }), stateDir: state });
      expect(r.evaluation!.blocking.map((f) => f.ruleId).sort()).toEqual(['A002', 'R003']);
      expect(r.evaluation!.advice.map((f) => f.ruleId)).toEqual(['W006']);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
