/**
 * Agent hook benchmark: `testwitness hook --agent claude` on a Stop event, on an uncommitted change, the way Claude
 * Code starts it. Budget: 3 s at the 95th percentile, Node start up included (agent guard acceptance criterion 10).
 *
 *   pnpm bench:hook                   both cases, 20 samples each
 *   pnpm bench:hook --only worktree30 one case (worktree30 or worktree30-in-1000)
 *   pnpm bench:hook --hook-runs 40    samples per case
 *   pnpm bench:hook --enforce         exit 1 when a case is over budget
 *   pnpm bench:hook --prefix "unshare -rn"   wrap the hook process (network off)
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpus, platform, release, tmpdir } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, SIZES, type GenerateOptions, type GenerateResult } from './generate.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOK_BUDGET_MS = 3_000;

interface Args {
  only?: string;
  prefix: string[];
  enforce: boolean;
  hookRuns: number;
  work: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { prefix: [], enforce: false, hookRuns: 20, work: join(tmpdir(), 'testwitness-bench-hook'), out: join(ROOT, 'bench', 'hook-results.json') };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    const next = (): string => argv[++i] ?? '';
    if (x === '--only') a.only = next();
    else if (x === '--prefix') a.prefix = next().split(' ').filter(Boolean);
    else if (x === '--enforce') a.enforce = true;
    else if (x === '--hook-runs') a.hookRuns = Number(next());
    else if (x === '--work') a.work = resolve(next());
    else if (x === '--out') a.out = resolve(next());
    else throw new Error(`unknown argument ${x}`);
  }
  return a;
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

/**
 * Hook cases: `testwitness hook --agent claude` on a Stop event, as Claude Code starts it, on an uncommitted change.
 * Every sample is a new process (Node start up included) and a new session, so the loop guard never steps aside and
 * each run does the full work: snapshot the working tree, diff, parse, grade, quote the base text, write the state.
 */
interface HookCaseResult {
  name: string;
  description: string;
  budgetMs: number;
  /** Files tracked in the repository, and files the working tree change touches. */
  repoFiles: number;
  changedFiles: number;
  samples: number;
  wallMs: number[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  maxRssMb: number | null;
  blocked: number;
  findingsInReason: number;
  overBudget: boolean;
}

/** Nearest rank percentile. */
function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Turn the generated head commit into an uncommitted change of `keep` files (all of them when undefined) on top of base. */
function asWorktreeChange(gen: GenerateResult, keep: number | undefined): { repoFiles: number; changedFiles: number } {
  const changed = sh(gen.repo, ['diff', '--name-only', gen.baseSha, gen.headSha]).split('\n').filter(Boolean);
  // Test files first, so a 30 file slice has the weakened tests in it.
  const tests = changed.filter((p) => /test|spec/i.test(p));
  const rest = changed.filter((p) => !/test|spec/i.test(p));
  const kept = keep === undefined ? changed : [...tests.slice(0, Math.ceil(keep / 3)), ...rest].slice(0, keep);
  sh(gen.repo, ['checkout', '-q', '--detach', gen.baseSha]);
  sh(gen.repo, ['branch', '-f', 'main', gen.baseSha]);
  sh(gen.repo, ['checkout', '-q', 'main']);
  for (let i = 0; i < kept.length; i += 200) sh(gen.repo, ['checkout', gen.headSha, '--', ...kept.slice(i, i + 200)]);
  sh(gen.repo, ['reset', '-q']);
  const now = sh(gen.repo, ['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean).length;
  return { repoFiles: sh(gen.repo, ['ls-files']).split('\n').filter(Boolean).length, changedFiles: now };
}

async function runHookOnce(repo: string, args: Args, session: string, tmp: string): Promise<{ wallMs: number; maxRssMb: number | null; exitCode: number | null; stdout: string }> {
  const cmd = [...args.prefix, process.execPath, '-r', join(ROOT, 'bench', 'rss-hook.cjs'), join(ROOT, 'packages', 'cli', 'bin', 'testwitness.js'), 'hook', '--agent', 'claude'];
  const event = JSON.stringify({ session_id: session, transcript_path: null, cwd: repo, permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' });
  const t0 = performance.now();
  const usageFile = join(tmp, `${session}.usage.json`);
  rmSync(usageFile, { force: true });
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: repo, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, TW_BENCH_USAGE_FILE: usageFile } });
  let stdout = '';
  child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stdin!.end(event);
  const exitCode = await new Promise<number | null>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => res(code));
  });
  const wallMs = performance.now() - t0;
  let maxRssMb: number | null = null;
  try {
    maxRssMb = Math.round((JSON.parse(readFileSync(usageFile, 'utf8')) as { maxRSSKb: number }).maxRSSKb / 1024);
  } catch {
    /* the hook exits through process.exit, which the usage hook may not see */
  }
  return { wallMs, maxRssMb, exitCode, stdout };
}

async function runHookCase(name: string, description: string, opts: Omit<GenerateOptions, 'dir'>, keep: number | undefined, args: Args): Promise<HookCaseResult> {
  const dir = join(args.work, name);
  const gen = generate({ ...opts, dir });
  const shape = asWorktreeChange(gen, keep);
  const tmp = join(args.work, `${name}-tmp`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  process.stdout.write(`\n${name}: ${description}; ${shape.repoFiles} tracked files, ${shape.changedFiles} changed in the working tree\n`);
  // One warm up run (file cache, helper index cache), not counted.
  await runHookOnce(gen.repo, args, `${name}-warm`, tmp);
  const wall: number[] = [];
  const rss: number[] = [];
  let blocked = 0;
  let findingsInReason = 0;
  for (let i = 0; i < args.hookRuns; i++) {
    const s = await runHookOnce(gen.repo, args, `${name}-${i}`, tmp);
    wall.push(s.wallMs);
    if (s.maxRssMb !== null) rss.push(s.maxRssMb);
    let reason = '';
    try {
      const out = JSON.parse(s.stdout) as { decision?: string; reason?: string };
      if (out.decision === 'block') blocked++;
      reason = out.reason ?? '';
    } catch {
      /* allowed without output */
    }
    findingsInReason = Number(/: (\d+) test integrity finding/.exec(reason)?.[1] ?? 0);
    if (s.exitCode !== 0) process.stdout.write(`  run ${i + 1}: exit ${s.exitCode}\n`);
  }
  const result: HookCaseResult = {
    name,
    description,
    budgetMs: HOOK_BUDGET_MS,
    repoFiles: shape.repoFiles,
    changedFiles: shape.changedFiles,
    samples: wall.length,
    wallMs: wall.map((w) => Math.round(w)),
    p50Ms: Math.round(percentile(wall, 50)),
    p95Ms: Math.round(percentile(wall, 95)),
    maxMs: Math.round(Math.max(...wall)),
    maxRssMb: rss.length ? Math.max(...rss) : null,
    blocked,
    findingsInReason,
    overBudget: percentile(wall, 95) > HOOK_BUDGET_MS,
  };
  process.stdout.write(`  ${result.samples} runs: p50 ${(result.p50Ms / 1000).toFixed(2)} s, p95 ${(result.p95Ms / 1000).toFixed(2)} s, max ${(result.maxMs / 1000).toFixed(2)} s, budget ${HOOK_BUDGET_MS / 1000} s at p95; blocked ${blocked} of ${result.samples} (${findingsInReason} blocking findings)\n`);
  {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}

/** 30 files, every one changed: 10 test files (one deleted test, one skipped, one loosened, one new without assertion) and 20 production files. */
const WORKTREE30: Omit<GenerateOptions, 'dir'> = { seed: 3, files: 30, testFiles: 10, xmlBytes: 64 * 1024, mutations: { deleted: 1, skipped: 1, loosened: 1, newWithoutAssertion: 1 } };
/** The 1,000 file repository with 30 of its files changed: what the snapshot costs when the repository is not small. */
const WORKTREE30_IN_1000: Omit<GenerateOptions, 'dir'> = { ...SIZES['1000'], xmlBytes: 64 * 1024 };


async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.work, { recursive: true });
  const defs: Array<[string, string, Omit<GenerateOptions, 'dir'>, number | undefined]> = [
    ['worktree30', 'agent hook, Stop event, 30 file repository with every file changed and uncommitted', WORKTREE30, undefined],
    ['worktree30-in-1000', 'agent hook, Stop event, 1,000 file repository with 30 files changed and uncommitted', WORKTREE30_IN_1000, 30],
  ];
  const cases: HookCaseResult[] = [];
  for (const [name, description, opts, keep] of defs) {
    if (args.only && args.only !== name) continue;
    cases.push(await runHookCase(name, description, opts, keep, args));
  }
  process.stdout.write('\n| hook case          | tracked | changed | runs | p50 s | p95 s | max s | budget s (p95) | peak RSS MB |\n');
  process.stdout.write('|--------------------|--------:|--------:|-----:|------:|------:|------:|---------------:|------------:|\n');
  for (const h of cases) {
    process.stdout.write(`| ${h.name.padEnd(18)} | ${pad(h.repoFiles, 7)} | ${pad(h.changedFiles, 7)} | ${pad(h.samples, 4)} | ${pad((h.p50Ms / 1000).toFixed(2), 5)} | ${pad((h.p95Ms / 1000).toFixed(2), 5)} | ${pad((h.maxMs / 1000).toFixed(2), 5)} | ${pad((h.budgetMs / 1000).toFixed(0), 14)} | ${pad(h.maxRssMb ?? '?', 11)} |\n`);
  }
  const cpu = cpus();
  const out = { generatedAt: new Date().toISOString(), machine: { cores: cpu.length, model: cpu[0]?.model.trim() ?? null, platform: platform(), release: release(), node: process.version }, prefix: args.prefix, hookCases: cases };
  writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`results written to ${args.out}\n`);
  const over = cases.filter((h) => h.overBudget);
  if (over.length) {
    process.stdout.write(`over budget: ${over.map((h) => `${h.name} (p95 ${(h.p95Ms / 1000).toFixed(2)} s > ${h.budgetMs / 1000} s)`).join(', ')}\n`);
    if (args.enforce) process.exitCode = 1;
  } else process.stdout.write('all hook cases within budget\n');
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? err}\n`);
  process.exitCode = 1;
});
