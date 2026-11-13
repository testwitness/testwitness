// `testwitness init --agent <name>`: writes the hook config that puts `testwitness hook` into the agent's loop, and
// nothing else. It merges into an existing config without touching other keys, prints what it wrote, and running it
// twice changes nothing.
//
// Config locations and shapes, from the vendor documentation read on 13 Nov 2026:
//   Claude Code  .claude/settings.json, key "hooks"       https://code.claude.com/docs/en/hooks
//   Cursor       .cursor/hooks.json, "version": 1          https://cursor.com/docs/agent/hooks
//   Codex        .codex/hooks.json, key "hooks"            https://learn.chatgpt.com/docs/hooks
//                (project hooks run only after the user reviews and trusts them with /hooks)
//   git          <git dir>/hooks/pre-push                  https://git-scm.com/docs/githooks#_pre_push
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { git } from '@testwitness/core';
import type { Agent } from './hook/events.js';

export interface InitOptions {
  agent: Agent;
  cwd: string;
  /** Overwrite a different existing git pre-push hook. */
  force?: boolean | undefined;
  /** How the hook starts testwitness; default `testwitness` when it is on PATH, else `npx --no-install testwitness`. */
  command?: string | undefined;
  /** PATH to look for `testwitness` on; default the process PATH. */
  pathEnv?: string | undefined;
}

export interface InitResult {
  exitCode: number;
  /** One entry per file init looked at. */
  files: Array<{ path: string; action: 'created' | 'updated' | 'unchanged' | 'refused' }>;
  /** What to print. */
  lines: string[];
}

/** Seconds the agent waits for the hook; above the hook's own 20 s limit, so the hook answers before the agent gives up on it. */
const AGENT_TIMEOUT_SECONDS = 30;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is this hook command one of ours? Matches `testwitness hook`, `npx ... testwitness hook` and `node .../testwitness.js hook`. */
export function isTestwitnessHook(command: unknown): boolean {
  return typeof command === 'string' && /\btestwitness(\.js)?["']?\s+hook\b/.test(command);
}

export function baseCommand(opts: Pick<InitOptions, 'command' | 'pathEnv'>): string {
  if (opts.command) return opts.command;
  const names = process.platform === 'win32' ? ['testwitness.cmd', 'testwitness.exe', 'testwitness'] : ['testwitness'];
  for (const dir of (opts.pathEnv ?? process.env['PATH'] ?? '').split(delimiter)) {
    if (dir && names.some((n) => existsSync(join(dir, n)))) return 'testwitness';
  }
  // Never `npx -y`: the hook must not reach for the network when the package is missing.
  return 'npx --no-install testwitness';
}

/** The hooks block for Claude Code (.claude/settings.json and the plugin's hooks/hooks.json) and for Codex (.codex/hooks.json). */
export function hookGroups(agent: 'claude' | 'codex', command: string): Record<string, Array<{ matcher?: string; hooks: Json[] }>> {
  const handler = { type: 'command', command: `${command} hook --agent ${agent}`, timeout: AGENT_TIMEOUT_SECONDS };
  if (agent === 'claude') {
    return {
      // Bash: git commit and git push are checked. The edit tools: only paths on the `protect` list are ever denied.
      PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [handler] }],
      Stop: [{ hooks: [handler] }],
      SubagentStop: [{ hooks: [handler] }],
    };
  }
  return {
    PreToolUse: [{ matcher: '^(Bash|apply_patch)$', hooks: [handler] }],
    Stop: [{ hooks: [handler] }],
  };
}

/** The hooks for Cursor (.cursor/hooks.json). */
export function cursorHooks(command: string): Record<string, Json[]> {
  const cmd = `${command} hook --agent cursor`;
  return {
    beforeShellExecution: [{ command: cmd, timeout: AGENT_TIMEOUT_SECONDS }],
    preToolUse: [{ command: cmd, matcher: 'Write|Edit|Delete', timeout: AGENT_TIMEOUT_SECONDS }],
    stop: [{ command: cmd, timeout: AGENT_TIMEOUT_SECONDS }],
    subagentStop: [{ command: cmd, timeout: AGENT_TIMEOUT_SECONDS }],
  };
}

class InitError extends Error {}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new InitError(`${path} is not valid JSON (${(err as Error).message}); fix it or add the hooks by hand, nothing was written`);
  }
  if (!isRecord(doc)) throw new InitError(`${path} does not hold a JSON object; nothing was written`);
  return doc;
}

function hooksOf(doc: Json, path: string): Json {
  if (doc['hooks'] === undefined) doc['hooks'] = {};
  if (!isRecord(doc['hooks'])) throw new InitError(`"hooks" in ${path} is not an object; nothing was written`);
  return doc['hooks'];
}

function listOf(hooks: Json, event: string, path: string): unknown[] {
  if (hooks[event] === undefined) hooks[event] = [];
  if (!Array.isArray(hooks[event])) throw new InitError(`"hooks.${event}" in ${path} is not a list; nothing was written`);
  return hooks[event] as unknown[];
}

/** Merge matcher groups (Claude Code and Codex shape): our handler is replaced where it already is, else a group is added. */
function mergeGroups(doc: Json, wanted: ReturnType<typeof hookGroups>, path: string): void {
  const hooks = hooksOf(doc, path);
  for (const [event, groups] of Object.entries(wanted)) {
    const list = listOf(hooks, event, path);
    for (const want of groups) {
      const ours = want.hooks[0]!;
      const existing = list.find((g): g is Json => isRecord(g) && Array.isArray(g['hooks']) && g['hooks'].some((h) => isRecord(h) && isTestwitnessHook(h['command'])));
      if (!existing) {
        list.push(want);
        continue;
      }
      const handlers = existing['hooks'] as unknown[];
      existing['hooks'] = handlers.map((h) => (isRecord(h) && isTestwitnessHook(h['command']) ? ours : h));
      // The matcher is ours to set only when the group holds nothing but our handler.
      if (handlers.length === 1) {
        if (want.matcher !== undefined) existing['matcher'] = want.matcher;
        else delete existing['matcher'];
      }
    }
  }
}

function mergeCursor(doc: Json, wanted: ReturnType<typeof cursorHooks>, path: string): void {
  if (doc['version'] === undefined) doc['version'] = 1;
  const hooks = hooksOf(doc, path);
  for (const [event, defs] of Object.entries(wanted)) {
    const list = listOf(hooks, event, path);
    const i = list.findIndex((h) => isRecord(h) && isTestwitnessHook(h['command']));
    if (i === -1) list.push(defs[0]!);
    else list[i] = defs[0]!;
  }
}

function writeJson(path: string, doc: Json): 'created' | 'updated' | 'unchanged' {
  const text = JSON.stringify(doc, null, 2) + '\n';
  const had = existsSync(path);
  if (had && readFileSync(path, 'utf8') === text) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return had ? 'updated' : 'created';
}

export function prePushScript(command: string): string {
  return [
    '#!/bin/sh',
    '# testwitness pre-push hook, installed by `testwitness init --agent git` (docs/agent-guard.md).',
    '# Refuses a push whose commits weaken tests. For coding agents that have no hooks of their own.',
    `exec ${command} hook --agent git`,
    '',
  ].join('\n');
}

export async function init(opts: InitOptions): Promise<InitResult> {
  const cwd = resolve(opts.cwd);
  let top = cwd;
  let inRepo = true;
  try {
    top = (await git(['rev-parse', '--show-toplevel'], { cwd })).trim();
  } catch {
    inRepo = false;
  }
  const command = baseCommand(opts);
  const files: InitResult['files'] = [];
  const lines: string[] = [];
  const rel = (p: string): string => relative(top, p).split('\\').join('/') || p;
  const report = (path: string, action: InitResult['files'][number]['action'], what: string): void => {
    files.push({ path, action });
    lines.push(`${action === 'unchanged' ? 'unchanged' : action} ${rel(path)}${action === 'unchanged' ? ' (already set up)' : `: ${what}`}`);
  };
  try {
    if (opts.agent === 'claude') {
      const path = join(top, '.claude', 'settings.json');
      const doc = readJson(path);
      mergeGroups(doc, hookGroups('claude', command), path);
      report(path, writeJson(path, doc), `hooks PreToolUse (Bash and the edit tools), Stop and SubagentStop run \`${command} hook --agent claude\``);
      lines.push('Commit the file so the whole team gets the guard. Claude Code picks it up in the next session.');
    } else if (opts.agent === 'codex') {
      const path = join(top, '.codex', 'hooks.json');
      const doc = readJson(path);
      mergeGroups(doc, hookGroups('codex', command), path);
      report(path, writeJson(path, doc), `hooks PreToolUse (Bash and apply_patch) and Stop run \`${command} hook --agent codex\``);
      lines.push('Codex runs a project hook only after you have reviewed and trusted it: open Codex in this repository and run /hooks. A changed hook must be trusted again.');
    } else if (opts.agent === 'cursor') {
      const path = join(top, '.cursor', 'hooks.json');
      const doc = readJson(path);
      mergeCursor(doc, cursorHooks(command), path);
      report(path, writeJson(path, doc), `hooks beforeShellExecution, preToolUse (file tools), stop and subagentStop run \`${command} hook --agent cursor\``);
      lines.push('Cursor reloads hooks.json when it is saved; the Hooks tab shows what ran.');
    } else {
      if (!inRepo) throw new InitError(`${cwd} is not inside a git repository`);
      const dir = resolve(top, (await git(['rev-parse', '--git-path', 'hooks'], { cwd: top })).trim());
      const path = join(dir, 'pre-push');
      const script = prePushScript(command);
      if (existsSync(path) && readFileSync(path, 'utf8') === script) {
        report(path, 'unchanged', '');
      } else if (existsSync(path) && !opts.force) {
        files.push({ path, action: 'refused' });
        lines.push(`refused ${rel(path)}: a different pre-push hook is already there. Add this line to it yourself, or pass --force to replace it:`, `  ${command} hook --agent git`);
        return { exitCode: 1, files, lines };
      } else {
        const had = existsSync(path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, script);
        chmodSync(path, 0o755);
        report(path, had ? 'updated' : 'created', `git runs \`${command} hook --agent git\` before every push`);
      }
      lines.push('This hook lives in your clone only (git does not version hooks), and git push --no-verify skips it. The pull request check is the backstop.');
    }
  } catch (err) {
    if (err instanceof InitError) return { exitCode: 2, files, lines: [...lines, err.message] };
    throw err;
  }
  if (command !== 'testwitness' && !opts.command) lines.push('testwitness is not on your PATH, so the hook starts it with npx --no-install: add testwitness to the devDependencies, or install it globally and run init again.');
  return { exitCode: 0, files, lines };
}
