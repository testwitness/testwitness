// Agent hook adapters: one thin parser and one renderer per agent. Each adapter turns the agent's hook event JSON
// (stdin) into a HookEvent, and a Decision back into the agent's documented blocking format. Nothing here reads the
// repository or runs anything; hook/run.ts does the check.
//
// Vendor documentation the adapters were written against (all read on 13 Nov 2026; none of the pages shows a "last
// updated" date, so the read date is the reference):
//   Claude Code  https://code.claude.com/docs/en/hooks
//   Cursor       https://cursor.com/docs/agent/hooks
//   Codex        https://learn.chatgpt.com/docs/hooks
//   git          https://git-scm.com/docs/githooks#_pre_push (stable format; not a vendor hook protocol)
// The recorded payloads in fixtures/hooks follow the examples on those pages. When a vendor changes its format, change
// the adapter and its fixture together and update the date here and in fixtures/hooks/README.md.

export const AGENTS = ['claude', 'cursor', 'codex', 'git'] as const;
export type Agent = (typeof AGENTS)[number];

export interface PushedRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface HookEvent {
  agent: Agent;
  /** What the agent is about to do. `other` is anything the guard has no opinion on. */
  kind: 'commit' | 'push' | 'stop' | 'edit' | 'other';
  /** The vendor's event name, for messages and for the output shape. */
  name: string;
  /** How the answer must be shaped. */
  shape: 'pretool' | 'stop' | 'cursor-permission' | 'cursor-stop' | 'git';
  sessionId?: string;
  /** Directory the agent works in, when the payload names one. */
  cwd?: string;
  /** Shell command, for commit and push. */
  command?: string;
  /** Directory given with `git -C <dir>`, relative to cwd. */
  gitDir?: string;
  /** Files an edit event is about to change. */
  paths?: string[];
  /** Refs a `git push` is sending (pre-push only). */
  pushes?: PushedRef[];
}

export interface Decision {
  block: boolean;
  /** Text for the agent: why it was blocked and what to do. Set when block is true. */
  reason?: string;
  /** Text for the person at the keyboard: the guard stepped aside, failed or timed out. */
  note?: string;
}

export interface HookOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Does this shell command run `git commit` or `git push`? Over reading is cheap (one extra check), so the test is a
 * pattern on the command text, not a shell parser: `git`, any global options, then the subcommand, anywhere a command
 * can start. A quoted mention (`echo "git push"`) also matches, which only costs time.
 */
export function gitAction(command: string): { kind: 'commit' | 'push'; dir?: string } | undefined {
  const re = /(?:^|[\s;&|(`'"])git((?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S+)?))*)\s+(commit|push)(?=$|[\s;&|)`'"])/g;
  let hit: { kind: 'commit' | 'push'; dir?: string } | undefined;
  for (const m of command.matchAll(re)) {
    const kind = m[2] as 'commit' | 'push';
    const dir = /-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(m[1] ?? '');
    const found = { kind, ...(dir ? { dir: dir[1] ?? dir[2] ?? dir[3] ?? '' } : {}) };
    // A push sends what earlier commits recorded; when one command line does both, the push decides.
    if (!hit || kind === 'push') hit = found;
  }
  return hit;
}

/** Paths named by a Codex apply_patch body ("*** Update File: path" and its siblings). */
export function patchPaths(patch: string): string[] {
  const out = new Set<string>();
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) out.add(m[1]!.trim());
  return [...out];
}

function shellEvent(base: Omit<HookEvent, 'kind'>, command: string | undefined): HookEvent {
  const action = command ? gitAction(command) : undefined;
  if (!action) return { ...base, kind: 'other' };
  return { ...base, kind: action.kind, command: command!, ...(action.dir ? { gitDir: action.dir } : {}) };
}

function commandText(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' ');
  return str(v);
}

// Claude Code. https://code.claude.com/docs/en/hooks, read 13 Nov 2026.
// Input: session_id, cwd, hook_event_name; PreToolUse adds tool_name and tool_input (Bash: command; Write and Edit:
// file_path); Stop and SubagentStop add stop_hook_active.
function parseClaude(p: Json): HookEvent {
  const name = str(p['hook_event_name']) ?? '';
  const base = { agent: 'claude' as const, name, ...(str(p['session_id']) ? { sessionId: str(p['session_id'])! } : {}), ...(str(p['cwd']) ? { cwd: str(p['cwd'])! } : {}) };
  if (name === 'Stop' || name === 'SubagentStop') return { ...base, kind: 'stop', shape: 'stop' };
  if (name !== 'PreToolUse') return { ...base, kind: 'other', shape: 'pretool' };
  const tool = str(p['tool_name']) ?? '';
  const input = isRecord(p['tool_input']) ? p['tool_input'] : {};
  if (tool === 'Bash') return shellEvent({ ...base, shape: 'pretool' }, commandText(input['command']));
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const path = str(input['file_path']) ?? str(input['notebook_path']);
    return path ? { ...base, kind: 'edit', shape: 'pretool', paths: [path] } : { ...base, kind: 'other', shape: 'pretool' };
  }
  return { ...base, kind: 'other', shape: 'pretool' };
}

// Codex. https://learn.chatgpt.com/docs/hooks, read 13 Nov 2026.
// Input: session_id, cwd, hook_event_name, turn_id; PreToolUse adds tool_name and tool_input (Bash and apply_patch both
// carry tool_input.command); Stop adds stop_hook_active. The output shapes are the ones Claude Code uses. Project
// hooks run only after the user has reviewed and trusted them (/hooks).
function parseCodex(p: Json): HookEvent {
  const name = str(p['hook_event_name']) ?? '';
  const base = { agent: 'codex' as const, name, ...(str(p['session_id']) ? { sessionId: str(p['session_id'])! } : {}), ...(str(p['cwd']) ? { cwd: str(p['cwd'])! } : {}) };
  if (name === 'Stop' || name === 'SubagentStop') return { ...base, kind: 'stop', shape: 'stop' };
  if (name !== 'PreToolUse') return { ...base, kind: 'other', shape: 'pretool' };
  const tool = str(p['tool_name']) ?? '';
  const input = isRecord(p['tool_input']) ? p['tool_input'] : {};
  const command = commandText(input['command']);
  if (tool === 'apply_patch') {
    const paths = patchPaths(command ?? '');
    return paths.length ? { ...base, kind: 'edit', shape: 'pretool', paths } : { ...base, kind: 'other', shape: 'pretool' };
  }
  return shellEvent({ ...base, shape: 'pretool' }, command);
}

// Cursor. https://cursor.com/docs/agent/hooks, read 13 Nov 2026.
// Input: conversation_id, hook_event_name, workspace_roots; beforeShellExecution adds command and cwd; preToolUse adds
// tool_name, tool_input and cwd; stop and subagentStop add status and loop_count. The page does not give the
// tool_input shape of the file tools, so the edit path is read from file_path, path or target_file, whichever is there.
function parseCursor(p: Json): HookEvent {
  const name = str(p['hook_event_name']) ?? '';
  const roots = Array.isArray(p['workspace_roots']) ? p['workspace_roots'].filter((x): x is string => typeof x === 'string') : [];
  const cwd = str(p['cwd']) ?? roots[0];
  const base = { agent: 'cursor' as const, name, ...(str(p['conversation_id']) ? { sessionId: str(p['conversation_id'])! } : {}), ...(cwd ? { cwd } : {}) };
  if (name === 'stop' || name === 'subagentStop') {
    // Only a completed turn is asked to continue; an aborted or failed one is left alone.
    const status = str(p['status']);
    return { ...base, kind: status === undefined || status === 'completed' ? 'stop' : 'other', shape: 'cursor-stop' };
  }
  if (name === 'beforeShellExecution') return shellEvent({ ...base, shape: 'cursor-permission' }, commandText(p['command']));
  if (name === 'preToolUse') {
    const tool = str(p['tool_name']) ?? '';
    const input = isRecord(p['tool_input']) ? p['tool_input'] : {};
    if (tool === 'Shell') return shellEvent({ ...base, shape: 'cursor-permission' }, commandText(input['command']));
    const path = str(input['file_path']) ?? str(input['path']) ?? str(input['target_file']);
    if (path && /^(Write|Edit|Delete|MultiEdit|StrReplace|EditNotebook)$/.test(tool)) return { ...base, kind: 'edit', shape: 'cursor-permission', paths: [path] };
  }
  return { ...base, kind: 'other', shape: name === 'stop' || name === 'subagentStop' ? 'cursor-stop' : 'cursor-permission' };
}

// git pre-push. https://git-scm.com/docs/githooks#_pre_push: stdin has one line per pushed ref,
// "<local ref> SP <local object name> SP <remote ref> SP <remote object name> LF".
function parseGit(text: string): HookEvent {
  const pushes: PushedRef[] = [];
  for (const line of text.split('\n')) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (localRef && localSha && remoteRef && remoteSha && /^[0-9a-f]{40,64}$/.test(localSha)) pushes.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return { agent: 'git', kind: 'push', name: 'pre-push', shape: 'git', pushes };
}

/** Parse the hook event the agent wrote to stdin. Throws on text that is not the agent's JSON. */
export function parseEvent(agent: Agent, text: string): HookEvent {
  if (agent === 'git') return parseGit(text);
  const payload: unknown = JSON.parse(text);
  if (!isRecord(payload)) throw new Error('the hook event is not a JSON object');
  if (agent === 'claude') return parseClaude(payload);
  if (agent === 'codex') return parseCodex(payload);
  return parseCursor(payload);
}

/** The shape to answer in when the event itself could not be parsed: the one that can never block by accident. */
export function fallbackEvent(agent: Agent, text: string): HookEvent {
  let name = '';
  try {
    const p: unknown = JSON.parse(text);
    if (isRecord(p)) name = str(p['hook_event_name']) ?? '';
  } catch {
    /* not JSON */
  }
  const stop = /^(stop|subagentstop)$/i.test(name);
  const shape: HookEvent['shape'] = agent === 'git' ? 'git' : agent === 'cursor' ? (stop ? 'cursor-stop' : 'cursor-permission') : stop ? 'stop' : 'pretool';
  return { agent, kind: 'other', name, shape };
}

/**
 * Render a decision in the agent's documented format.
 *
 * Claude Code and Codex, PreToolUse: deny with hookSpecificOutput.permissionDecision "deny" and a reason, exit 0.
 * Allowing prints no decision at all (never permissionDecision "allow", which would skip the user's own permission
 * prompt); a note travels in systemMessage, which both show to the user.
 * Claude Code and Codex, Stop and SubagentStop: {"decision":"block","reason":...}, exit 0; the reason becomes the
 * agent's next instruction.
 * Cursor, beforeShellExecution and preToolUse: {"permission":"deny","user_message","agent_message"}; allowing prints
 * {"permission":"allow"} because Cursor treats invalid output of a permission hook as a block.
 * Cursor, stop and subagentStop: {"followup_message":...} is submitted as the next user message; {} lets it stop.
 * git pre-push: exit 1 with the reason on stderr refuses the push.
 */
export function renderDecision(event: HookEvent, d: Decision): HookOutput {
  const stderr = d.block ? '' : d.note ? `testwitness: ${d.note}\n` : '';
  const json = (o: Json): HookOutput => ({ stdout: JSON.stringify(o) + '\n', stderr, exitCode: 0 });
  switch (event.shape) {
    case 'pretool':
      if (d.block) return json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason ?? '' } });
      return d.note ? json({ systemMessage: `testwitness: ${d.note}` }) : { stdout: '', stderr, exitCode: 0 };
    case 'stop':
      if (d.block) return json({ decision: 'block', reason: d.reason ?? '' });
      return d.note ? json({ systemMessage: `testwitness: ${d.note}` }) : { stdout: '', stderr, exitCode: 0 };
    case 'cursor-permission':
      if (d.block) return json({ permission: 'deny', user_message: firstLine(d.reason ?? ''), agent_message: d.reason ?? '' });
      return json({ permission: 'allow', ...(d.note ? { user_message: `testwitness: ${d.note}` } : {}) });
    case 'cursor-stop':
      return json(d.block ? { followup_message: d.reason ?? '' } : {});
    case 'git':
      return d.block ? { stdout: '', stderr: `${d.reason ?? ''}\n`, exitCode: 1 } : { stdout: '', stderr, exitCode: 0 };
  }
}

function firstLine(s: string): string {
  return s.split('\n', 1)[0] ?? s;
}
