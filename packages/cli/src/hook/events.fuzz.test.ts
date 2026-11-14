// Fuzz: the hook event parser of each agent, the command scanner and the answer renderer (docs/threat-model.md, "The
// hook"). The event comes from the agent's harness, but the command line, the paths and the patch in it are written by
// the model the hook is guarding against.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { hasUnsafe } from '@testwitness/core';
import { fuzz, hostileText, mutated, TARGET_TIMEOUT_MS } from '../../../../fuzz/kit.js';
import { AGENTS, fallbackEvent, gitAction, parseEvent, patchPaths, renderDecision, type Agent, type HookEvent } from './events.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/hooks');
const seedsOf = (agent: Agent): string[] => readdirSync(join(fixtures, agent)).map((f) => readFileSync(join(fixtures, agent, f), 'utf8'));

const KINDS = ['commit', 'push', 'stop', 'edit', 'other'];
const SHAPES = ['pretool', 'stop', 'cursor-permission', 'cursor-stop', 'git'];

function wellFormed(e: HookEvent, agent: Agent): void {
  expect(e.agent).toBe(agent);
  expect(KINDS).toContain(e.kind);
  expect(SHAPES).toContain(e.shape);
  expect(typeof e.name).toBe('string');
  for (const k of ['sessionId', 'cwd', 'command', 'gitDir'] as const) if (e[k] !== undefined) expect(typeof e[k]).toBe('string');
  if (e.paths) expect(e.paths.every((p) => typeof p === 'string')).toBe(true);
  if (e.kind === 'commit' || e.kind === 'push') expect(e.agent === 'git' || typeof e.command === 'string').toBe(true);
  for (const p of e.pushes ?? []) expect(p.localSha).toMatch(/^[0-9a-f]{40,64}$/);
}

/** Any JSON value under the keys the adapters read. */
const KEYS = ['hook_event_name', 'session_id', 'conversation_id', 'cwd', 'workspace_roots', 'tool_name', 'tool_input', 'command', 'file_path', 'notebook_path', 'path', 'target_file', 'status', 'stop_hook_active', '__proto__', 'constructor'];
const WORDS = ['PreToolUse', 'Stop', 'SubagentStop', 'preToolUse', 'beforeShellExecution', 'stop', 'subagentStop', 'Bash', 'Shell', 'Write', 'Edit', 'MultiEdit', 'apply_patch', 'completed', 'aborted', 'git commit -m x', 'git -C dir push', '*** Update File: a.ts'];
const value: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  v: fc.oneof({ maxDepth: 4 }, fc.constantFrom(...WORDS), hostileText(2), fc.constantFrom(null, true, 0, 1.5), fc.array(tie('v'), { maxLength: 3 }), fc.dictionary(fc.constantFrom(...KEYS), tie('v'), { maxKeys: 6 })),
})).v;

describe('fuzz: hook event parser', () => {
  for (const agent of AGENTS) {
    it(`${agent}: damaged events parse to a well formed event or throw an Error, and the fallback never throws`, async () => {
      const arb = agent === 'git' ? fc.oneof(mutated(seedsOf(agent)), hostileText(8)) : fc.oneof(mutated(seedsOf(agent)), fc.dictionary(fc.constantFrom(...KEYS), value, { maxKeys: 8 }).map((o) => JSON.stringify(o)), hostileText(4));
      await fuzz(`hook event parser, ${agent}`, arb, (text) => {
        let event: HookEvent | undefined;
        try {
          event = parseEvent(agent, text);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
        if (event) wellFormed(event, agent);
        const fb = fallbackEvent(agent, text);
        expect(fb.kind).toBe('other');
        expect(SHAPES).toContain(fb.shape);
      });
    }, TARGET_TIMEOUT_MS);
  }

  /** The regular expression gitAction used to be; exponential on long option runs, so it is only asked about short commands. */
  function gitActionByRegex(command: string): { kind: 'commit' | 'push'; dir?: string } | undefined {
    const re = /(?:^|[\s;&|(`'"])git((?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S+)?))*)\s+(commit|push)(?=$|[\s;&|)`'"])/g;
    let hit: { kind: 'commit' | 'push'; dir?: string } | undefined;
    for (const m of command.matchAll(re)) {
      const kind = m[2] as 'commit' | 'push';
      const dir = /-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(m[1] ?? '');
      const found = { kind, ...(dir ? { dir: dir[1] ?? dir[2] ?? dir[3] ?? '' } : {}) };
      if (!hit || kind === 'push') hit = found;
    }
    return hit;
  }

  const TOKENS = ['git', 'commit', 'push', '-c', '-C', '-m', '--no-verify', '--git-dir=x', '--', '-', '--a', '-c=x', 'user.name=x', '"a b"', "'a b'", '"', "'", 'dir', 'commit;', 'push)', ';', '&&', '|', '(', ')', '`', 'echo', 'x', 'commit-tree', 'gitx', '=', '\t', '\n', '  '];
  it('the command scanner agrees with the regular expression it replaced', async () => {
    await fuzz('hook git command scanner', fc.array(fc.oneof({ weight: 8, arbitrary: fc.constantFrom(...TOKENS) }, { weight: 1, arbitrary: hostileText(1) }), { maxLength: 9 }).chain((tokens) => fc.array(fc.constantFrom(' ', '', '  '), { minLength: tokens.length, maxLength: tokens.length }).map((gaps) => tokens.map((t, i) => t + gaps[i]).join(''))), (command) => {
      expect(gitAction(command)).toEqual(gitActionByRegex(command));
    });
  }, TARGET_TIMEOUT_MS);

  it('the answer is one line of JSON or nothing, with no control or invisible character from the reason', async () => {
    const event = fc.record({ agent: fc.constantFrom(...AGENTS), kind: fc.constantFrom('commit', 'push', 'stop', 'edit', 'other'), name: hostileText(1), shape: fc.constantFrom('pretool', 'stop', 'cursor-permission', 'cursor-stop', 'git') }) as fc.Arbitrary<HookEvent>;
    await fuzz('hook answer renderer', fc.tuple(event, fc.boolean(), hostileText(), fc.option(hostileText(), { nil: undefined })), ([e, block, reason, note]) => {
      const out = renderDecision(e, { block, ...(block ? { reason } : {}), ...(note !== undefined ? { note } : {}) });
      expect([0, 1]).toContain(out.exitCode);
      if (out.exitCode === 1) expect(e.shape === 'git' && block).toBe(true);
      expect(hasUnsafe(out.stderr.replace(/[\n\t]/g, ''))).toBe(false);
      if (out.stdout !== '') {
        expect(out.stdout.endsWith('\n') && out.stdout.indexOf('\n') === out.stdout.length - 1).toBe(true);
        const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
        const texts: string[] = [];
        JSON.stringify(parsed, (_k, v: unknown) => (typeof v === 'string' ? (texts.push(v), v) : v));
        for (const t of texts) expect(hasUnsafe(t.replace(/[\n\t]/g, ''))).toBe(false);
        // Blocking and allowing never trade places: a decision that does not block never carries a deny.
        if (!block) expect(JSON.stringify(parsed)).not.toMatch(/"(deny|block)"|followup_message/);
      }
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: the command scanner', () => {
  it('a command line with many options answers at once', () => {
    // The regex took time exponential in the number of options: 24 took half a second, 40 would not finish.
    const cases: Array<[string, 'commit' | 'push' | undefined]> = [
      [`git${' --a'.repeat(40)} x; git commit -m x`, 'commit'],
      [`git${' --no-pager'.repeat(25_000)} status`, undefined],
      [`git${' -c a=b'.repeat(20_000)} push`, 'push'],
      [`git ${'-'.repeat(100_000)}`, undefined],
      [`${'git '.repeat(25_000)}commit`, 'commit'],
      [`git -c "${'x '.repeat(50_000)}`, undefined],
      [`git${' '.repeat(100_000)}x`, undefined],
    ];
    for (const [cmd, kind] of cases) {
      const t0 = performance.now();
      const action = gitAction(cmd);
      expect(performance.now() - t0, cmd.slice(0, 30)).toBeLessThan(2000);
      expect(action?.kind, cmd.slice(0, 30)).toBe(kind);
    }
  });

  it('reads what the regex read', () => {
    expect(gitAction('git -c commit push')).toEqual({ kind: 'push' });
    expect(gitAction('git -C commit')).toEqual({ kind: 'commit' });
    expect(gitAction('git -C "my dir" -c user.name=x commit -m msg')).toEqual({ kind: 'commit', dir: 'my dir' });
    // A quoted mention also counts, and a push decides: over reading only costs one check.
    expect(gitAction('git -C "my dir" commit -m "git push"')).toEqual({ kind: 'push' });
    expect(gitAction('git --git-dir=.git --no-pager commit')).toEqual({ kind: 'commit' });
    expect(gitAction('git -- commit')).toEqual({ kind: 'commit' });
    expect(gitAction('git commit-tree')).toBeUndefined();
    expect(gitAction('git  \t commit\n')).toEqual({ kind: 'commit' });
  });

  it('an apply_patch body of 100 kB is read in linear time', () => {
    const t0 = performance.now();
    patchPaths(`${'*** Update File: '.repeat(6000)}\n${'*** Add File:'.repeat(8000)}`);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('regression: the answer to the agent', () => {
  it('escape sequences, bidirectional and invisible characters in the reason do not reach the agent or the terminal', () => {
    const reason = 'blocked: test \u001b[2K\u001b[1A named \u202eevil\u2066 \u{e0049}\u{e0067}nore\nsecond line\tkept';
    const git = renderDecision({ agent: 'git', kind: 'push', name: 'pre-push', shape: 'git' }, { block: true, reason });
    expect(git.exitCode).toBe(1);
    expect(git.stderr).toBe('blocked: test �[2K�[1A named �evil� ��nore\nsecond line\tkept\n');
    const claude = renderDecision({ agent: 'claude', kind: 'commit', name: 'PreToolUse', shape: 'pretool' }, { block: true, reason });
    expect((JSON.parse(claude.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason).toBe('blocked: test �[2K�[1A named �evil� ��nore\nsecond line\tkept');
  });
});
