// `testwitness hook --agent <name>`: the guard in the coding agent's loop. Reads the agent's hook event on stdin, runs
// the engine on the working tree when the agent is about to commit, push or stop, and answers in the agent's format.
//
// The promises, and how this file keeps them:
//   * No model, no network: only the engine and git run; nothing here opens a socket.
//   * Never executes the repository's code: the only child process is git (hook-safety.test.ts traces it).
//   * Safe on a repository the user does not trust: .testwitness.yml is read from the merge base only, never from the
//     working tree, so the change being judged cannot relax its own judge.
//   * Never leaves the agent stuck: the same finding blocks at most `hook.max_blocks` times per session, and a crash or
//     a timeout allows the action and says so.
import { isAbsolute, relative, resolve } from 'node:path';
import { git, GitError, isHookConfigPath, pathMatcher, SEVERITY_RANK, showFile, HOOK_DEFAULT_TIMEOUT_SECONDS, type ChangedFile, type Finding, type InventoryPair, type ResolvedConfig, type Severity } from '@testwitness/core';
import { check, ConfigError, defaultBase, loadConfig, type CheckResult } from '../check.js';
import { fallbackEvent, parseEvent, renderDecision, type Agent, type Decision, type HookEvent, type HookOutput } from './events.js';
import { defaultStateDir, readCounts, writeCounts } from './state.js';

export interface HookOptions {
  agent: Agent;
  /** The hook event as the agent wrote it to stdin. */
  input: string;
  /** Directory to use when the event names none; default the process directory. */
  cwd?: string | undefined;
  /** Base ref; default the repository's default branch. */
  base?: string | undefined;
  /** Seconds before the hook gives up and allows the action; default `hook.timeout` from the base config, then 20. */
  timeoutSeconds?: number | undefined;
  /** Comma separated globs of test results to read; default none (the hook checks the diff only). */
  results?: string | undefined;
  /** Where the loop guard keeps its counts; default a per user directory under os.tmpdir(). */
  stateDir?: string | undefined;
  /** Test seam: runs just before the check, so a test can make it slow or make it throw. */
  beforeCheck?: (() => Promise<void>) | undefined;
}

export interface HookResult extends HookOutput {
  decision: Decision;
  event: HookEvent;
  /** What the check found and how the hook graded it; absent when no check ran. */
  evaluation?: Evaluation;
}

/** A finding as the hook sees it: an engine finding, or a changed path from the `protect` list. */
export interface GuardFinding {
  ruleId: string;
  severity: Severity;
  path: string;
  line?: number;
  message: string;
  fingerprint: string;
  finding?: Finding;
}

export interface Evaluation {
  /** Findings that may block: open, at or above fail_on, not advice only. */
  blocking: GuardFinding[];
  /** Findings shown as advice: medium or above, but below fail_on, or of a rule that is advice only in the hook. */
  advice: GuardFinding[];
}

const where = (f: GuardFinding): string => `${f.path}${f.line ? `:${f.line}` : ''}`;

export interface EvaluateOptions {
  /** Rules that may block; default `hook.blocking` of the config. `'all'` lets every rule block (the replay uses it to measure). */
  blocking?: readonly string[] | 'all';
  /** Rules taken off the blocking list; default `hook.advice_only` of the config. */
  adviceOnly?: readonly string[];
  /** Hook config files that had no testwitness hook at the base: the change installs the guard. */
  gateInstalls?: ReadonlySet<string>;
}

/**
 * Grade a check result the way the hook does. Pure: no loop guard, no I/O.
 *
 * Blocking: open findings at or above `fail_on` (high unless the base config lowers it) of a rule on the blocking
 * list (`hook.blocking`, by default the small set the replay has proven) and not on `hook.advice_only`, plus changed
 * paths on the `protect` list. Everything else at medium or above is advice. Never blocking: acknowledged findings,
 * and W006 on a file the change adds or on a hook config that had no testwitness hook at the base (`gateInstalls`): a
 * gate that did not exist at the base cannot have been weakened, and running `testwitness init` on a branch must not
 * block that branch. The pull request check still reports both.
 */
export function evaluate(result: Pick<CheckResult, 'report' | 'files'>, config: ResolvedConfig, opts: EvaluateOptions = {}): Evaluation {
  const allowed = opts.blocking ?? config.hook.blocking;
  const adviceOnly = opts.adviceOnly ?? config.hook.adviceOnly;
  const gateInstalls = opts.gateInstalls ?? new Set<string>();
  const blocking: GuardFinding[] = [];
  const advice: GuardFinding[] = [];
  const byPath = new Map(result.files.map((f) => [f.path, f]));
  for (const f of result.report.findings) {
    if (f.acknowledged) continue;
    const g: GuardFinding = { ruleId: f.ruleId, severity: f.severity, path: f.location.path, ...(f.location.line ? { line: f.location.line } : {}), message: f.message, fingerprint: f.fingerprint, finding: f };
    const atThreshold = SEVERITY_RANK[f.severity] >= SEVERITY_RANK[config.failOn];
    const adviceRule = (allowed !== 'all' && !allowed.includes(f.ruleId)) || adviceOnly.includes(f.ruleId) || (f.ruleId === 'W006' && (byPath.get(f.location.path)?.status === 'added' || gateInstalls.has(f.location.path)));
    if (atThreshold && !adviceRule) blocking.push(g);
    else if (SEVERITY_RANK[f.severity] >= SEVERITY_RANK.medium) advice.push(g);
  }
  if (config.protect.length) {
    const isProtected = pathMatcher(config.protect);
    for (const f of result.files) {
      const hit = isProtected(f.path) ? f.path : f.oldPath && isProtected(f.oldPath) ? f.oldPath : undefined;
      if (hit) blocking.push({ ruleId: 'protect', severity: 'high', path: hit, message: `${hit} is on the protect list of .testwitness.yml and was ${f.status}`, fingerprint: `protect:${hit}` });
    }
  }
  return { blocking, advice };
}

const MAX_SHOWN = 5;
const MAX_TEXT_LINES = 30;
const MAX_REASON_CHARS = 9000; // Claude Code caps hook text at 10,000 characters.

function clip(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const shown = lines.slice(0, MAX_TEXT_LINES).map((l) => (l.length > 200 ? `${l.slice(0, 200)} ...` : l));
  if (lines.length > MAX_TEXT_LINES) shown.push(`... (${lines.length - MAX_TEXT_LINES} more lines)`);
  return shown.map((l) => `      ${l}`).join('\n');
}

/**
 * The base text a finding asks to restore: the whole test at the base when the finding names a test, the base file
 * when the file was deleted, else the text the rule recorded or the lines the hunk removed.
 */
async function baseText(f: GuardFinding, ctx: { top: string; base: string; files: ChangedFile[]; pairs: InventoryPair[] }): Promise<{ label: string; text: string } | undefined> {
  const file = ctx.files.find((x) => x.path === f.path || x.oldPath === f.path);
  const basePath = file?.oldPath ?? f.path;
  const read = async (): Promise<string | undefined> => {
    try {
      return await showFile(ctx.base, basePath, { cwd: ctx.top });
    } catch {
      return undefined;
    }
  };
  const at = `${basePath} at ${ctx.base.slice(0, 10)}`;
  if (file?.status === 'deleted' || f.ruleId === 'protect') {
    const src = await read();
    if (src !== undefined) return { label: `${at}; the whole file: git show ${ctx.base.slice(0, 10)}:${basePath}`, text: src };
  }
  if (f.finding) {
    const pair = ctx.pairs.find((p) => p.file.path === f.path);
    const names = [f.finding.subject, f.finding.before].filter((x): x is string => typeof x === 'string');
    const test = pair?.base?.tests.find((t) => names.includes(t.qualifiedName));
    if (test) {
      const src = await read();
      if (src !== undefined) return { label: `${at}, lines ${test.startLine} to ${test.endLine}`, text: src.split('\n').slice(test.startLine - 1, test.endLine).join('\n') };
    }
  }
  if (f.finding?.before !== undefined && f.finding.before.trim()) return { label: at, text: f.finding.before };
  if (file && f.line !== undefined) {
    const hunk = file.hunks.find((h) => f.line! >= h.headStart && f.line! < h.headStart + Math.max(h.added.length, 1));
    if (hunk && hunk.removed.length) return { label: `${at}, the lines this change replaced`, text: hunk.removed.join('\n') };
  }
  if (file && f.line === undefined) {
    // A finding about the file as a whole (the gate's own config): everything this change took out of it.
    const removed = file.hunks.flatMap((h) => h.removed);
    if (removed.length) return { label: `${at}, the lines this change removed; the whole file: git show ${ctx.base.slice(0, 10)}:${basePath}`, text: removed.join('\n') };
  }
  if (f.finding?.after !== undefined && f.finding.after.trim()) return { label: 'not in the base; this change added the line below, remove it', text: f.finding.after };
  return undefined;
}

const ACTION: Record<HookEvent['kind'], string> = { commit: 'this commit', push: 'this push', stop: 'the end of this turn', edit: 'this edit', other: 'this action' };

async function blockReason(event: HookEvent, blocking: GuardFinding[], counts: Record<string, number>, max: number, extra: { aside: number; advice: GuardFinding[] }, ctx: Parameters<typeof baseText>[1]): Promise<string> {
  const n = blocking.length;
  const lines = [`testwitness blocked ${ACTION[event.kind]}: ${n} test integrity finding${n === 1 ? '' : 's'} in the working tree, compared with ${ctx.base.slice(0, 10)}.`, ''];
  for (const [i, f] of blocking.slice(0, MAX_SHOWN).entries()) {
    lines.push(`${i + 1}. ${f.ruleId} ${f.severity} ${where(f)}: ${f.message}`);
    const text = await baseText(f, ctx);
    if (text) lines.push(`   Base text to restore (${text.label}):`, clip(text.text));
    lines.push(`   Block ${counts[f.fingerprint] ?? 1} of ${max} for this finding in this session.`);
  }
  if (n > MAX_SHOWN) lines.push(`${n - MAX_SHOWN} more: ${blocking.slice(MAX_SHOWN).map((f) => `${f.ruleId} ${where(f)}`).join(', ')}`);
  lines.push('', 'Restore the base text, or keep the change and state why in the PR description so a maintainer can acknowledge it.');
  lines.push(`The same finding blocks at most ${max} time${max === 1 ? '' : 's'} per session, then testwitness steps aside and tells the user. Editing .testwitness.yml or the hook config does not lift it: both are read from the base branch and reported.`);
  if (extra.aside) lines.push(`${extra.aside} other finding${extra.aside === 1 ? ' is' : 's are'} still open and no longer blocking.`);
  if (extra.advice.length) lines.push(`Advice, not blocking: ${extra.advice.slice(0, MAX_SHOWN).map((f) => `${f.ruleId} ${f.severity} ${where(f)}: ${f.message}`).join('; ')}`);
  const text = lines.join('\n');
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS)}\n... (cut; run testwitness check --worktree for the full report)` : text;
}

class HookTimeout extends Error {}

/** A deadline that can move once the configured timeout is known. */
class Deadline {
  private timer: NodeJS.Timeout | undefined;
  private reject: ((e: Error) => void) | undefined;
  private readonly start = Date.now();
  seconds: number;
  readonly promise: Promise<never>;
  constructor(seconds: number) {
    this.seconds = seconds;
    this.promise = new Promise<never>((_, rej) => (this.reject = rej));
    // The losing side of the race must not become an unhandled rejection.
    this.promise.catch(() => {});
    this.arm();
  }
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    const left = Math.max(0, this.seconds * 1000 - (Date.now() - this.start));
    this.timer = setTimeout(() => this.reject?.(new HookTimeout()), left);
  }
  set(seconds: number): void {
    this.seconds = seconds;
    this.arm();
  }
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Run the hook: parse, check, decide, render. Never throws; every failure allows the action and says so. */
export async function runHook(opts: HookOptions): Promise<HookResult> {
  let event: HookEvent;
  try {
    event = parseEvent(opts.agent, opts.input);
  } catch (err) {
    event = fallbackEvent(opts.agent, opts.input);
    const decision: Decision = { block: false, note: `the hook could not read the ${opts.agent} event (${(err as Error).message}); the action was allowed without a check.` };
    return { ...renderDecision(event, decision), decision, event };
  }
  const deadline = new Deadline(opts.timeoutSeconds ?? HOOK_DEFAULT_TIMEOUT_SECONDS);
  try {
    const done = await Promise.race([decide(event, opts, deadline), deadline.promise]);
    return { ...renderDecision(event, done.decision), ...done, event };
  } catch (err) {
    const decision: Decision =
      err instanceof HookTimeout
        ? { block: false, note: `the hook timed out after ${deadline.seconds} s; the action was allowed without a check. Run testwitness check --worktree to see the findings.` }
        : err instanceof ConfigError || err instanceof GitError
          ? { block: false, note: `the hook could not run the check (${err.message.split('\n')[0]}); the action was allowed without a check.` }
          : { block: false, note: `the hook crashed (${(err as Error).message?.split('\n')[0] ?? String(err)}); the action was allowed without a check.` };
    return { ...renderDecision(event, decision), decision, event };
  } finally {
    deadline.clear();
  }
}

const allow: { decision: Decision } = { decision: { block: false } };

async function decide(event: HookEvent, opts: HookOptions, deadline: Deadline): Promise<{ decision: Decision; evaluation?: Evaluation }> {
  if (event.kind === 'other') return allow;
  if (event.kind === 'push' && event.agent === 'git' && !(event.pushes ?? []).some((p) => !/^0+$/.test(p.localSha))) return allow;
  const start = resolve(event.cwd ?? opts.cwd ?? process.cwd(), event.gitDir ?? '.');
  let top: string;
  try {
    top = (await git(['rev-parse', '--show-toplevel'], { cwd: start })).trim();
  } catch {
    return allow; // not a git repository: nothing to compare
  }
  const base = opts.base ?? (await defaultBase(top));
  // The base config only: the working tree's .testwitness.yml is the agent's to edit, so it is never read here.
  const config = await loadConfig({ cwd: top, base, head: 'HEAD', format: 'json', configFromBaseOnly: true });
  if (opts.timeoutSeconds === undefined) deadline.set(config.hook.timeoutSeconds);

  if (event.kind === 'edit') {
    if (!config.protect.length) return allow;
    const isProtected = pathMatcher(config.protect);
    const hits: string[] = [];
    for (const p of event.paths ?? []) {
      const abs = resolve(start, p.replace(/\\/g, '/'));
      const rel = relative(top, abs).replace(/\\/g, '/');
      if (rel && !rel.startsWith('..') && !isAbsolute(rel) && isProtected(rel)) hits.push(rel);
    }
    if (!hits.length) return allow;
    const reason = `testwitness blocked this edit: ${hits.join(', ')} ${hits.length === 1 ? 'is' : 'are'} on the protect list of .testwitness.yml on the base branch, so an agent may not change ${hits.length === 1 ? 'it' : 'them'}. Leave the file as it is; if the test is wrong, say so in the PR description and let a maintainer change it.`;
    return { decision: { block: true, reason } };
  }

  await opts.beforeCheck?.();
  const common = { cwd: top, base, format: 'json' as const, quiet: true, log: () => {}, configFromBaseOnly: true, results: opts.results ?? '', coverage: '', mutation: '' };
  const runs: CheckResult[] = [];
  if (event.agent === 'git') {
    // pre-push: what is being pushed is committed, so each pushed commit is checked commit to commit.
    const seen = new Set<string>();
    for (const p of event.pushes ?? []) {
      if (/^0+$/.test(p.localSha) || seen.has(p.localSha)) continue;
      seen.add(p.localSha);
      runs.push(await check({ ...common, head: p.localSha }));
    }
  } else {
    runs.push(await check({ ...common, head: 'HEAD', worktree: true }));
  }
  const evaluation: Evaluation = { blocking: [], advice: [] };
  const seenFp = new Set<string>();
  const files: ChangedFile[] = [];
  const pairs: InventoryPair[] = [];
  for (const r of runs) {
    // A hook config file that had no testwitness hook at the base: the change installs the guard, it cannot weaken it.
    const gateInstalls = new Set<string>();
    for (const f of r.report.findings) {
      if (f.ruleId !== 'W006' || !isHookConfigPath(f.location.path)) continue;
      const file = r.files.find((x) => x.path === f.location.path);
      const atBase = await showFile(r.report.base, file?.oldPath ?? f.location.path, { cwd: top }).catch(() => undefined);
      if (atBase === undefined || !/testwitness/i.test(atBase)) gateInstalls.add(f.location.path);
    }
    const e = evaluate(r, config, { gateInstalls });
    for (const [from, to] of [[e.blocking, evaluation.blocking], [e.advice, evaluation.advice]] as const) {
      for (const f of from) {
        if (seenFp.has(f.fingerprint)) continue;
        seenFp.add(f.fingerprint);
        to.push(f);
      }
    }
    files.push(...r.files);
    pairs.push(...r.pairs);
  }
  const baseSha = runs[0]?.report.base ?? base;
  const ctx = { top, base: baseSha, files, pairs };
  const adviceNote = evaluation.advice.length ? `${evaluation.advice.length} finding${evaluation.advice.length === 1 ? '' : 's'} shown as advice, not blocking: ${evaluation.advice.slice(0, MAX_SHOWN).map((f) => `${f.ruleId} ${f.severity} ${where(f)}`).join(', ')}.` : undefined;
  if (!evaluation.blocking.length) return { decision: { block: false, ...(adviceNote ? { note: adviceNote } : {}) }, evaluation };

  const max = config.hook.maxBlocks;
  if (event.agent === 'git') {
    // A pre-push hook is not a loop: a refused push ends, and a person can pass --no-verify. No loop guard.
    return { decision: { block: true, reason: await blockReason(event, evaluation.blocking, {}, max, { aside: 0, advice: evaluation.advice }, ctx) }, evaluation };
  }

  // Loop guard: the same finding blocks at most `max` times per session.
  const stateDir = opts.stateDir ?? defaultStateDir();
  const session = event.sessionId ?? `no-session-${process.ppid}`;
  const counts = readCounts(stateDir, top, session);
  const fresh = evaluation.blocking.filter((f) => (counts[f.fingerprint] ?? 0) < max);
  const aside = evaluation.blocking.filter((f) => (counts[f.fingerprint] ?? 0) >= max);
  const asideNote = (list: GuardFinding[]): string =>
    `the guard stepped aside: ${list.length} finding${list.length === 1 ? ' was' : 's were'} blocked ${max} time${max === 1 ? '' : 's'} in this session and ${list.length === 1 ? 'is' : 'are'} still open (${list.slice(0, MAX_SHOWN).map((f) => `${f.ruleId} ${where(f)}`).join(', ')}${list.length > MAX_SHOWN ? ', ...' : ''}). It stops blocking so the agent is not stuck; review ${list.length === 1 ? 'it' : 'them'} before you merge.`;
  if (!fresh.length) return { decision: { block: false, note: [asideNote(aside), adviceNote].filter(Boolean).join(' ') }, evaluation };
  for (const f of fresh) counts[f.fingerprint] = (counts[f.fingerprint] ?? 0) + 1;
  if (!writeCounts(stateDir, top, session, counts)) {
    // Without a count the guard could block forever, so it does not block at all.
    return { decision: { block: false, note: `the loop guard could not write its state under ${stateDir}, so nothing was blocked. Open findings: ${fresh.slice(0, MAX_SHOWN).map((f) => `${f.ruleId} ${where(f)}`).join(', ')}.` }, evaluation };
  }
  return { decision: { block: true, reason: await blockReason(event, fresh, counts, max, { aside: aside.length, advice: evaluation.advice }, ctx) }, evaluation };
}
