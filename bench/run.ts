/**
 * Benchmark runner.
 *
 *   pnpm bench                      build, generate both repositories, run each three times
 *   pnpm bench --only large         one case
 *   pnpm bench --runs 5             more samples
 *   pnpm bench --enforce            exit 1 when the median is over budget (large 30 s, small 5 s)
 *   pnpm bench --prefix "unshare -rn"      wrap the CLI invocation (network off)
 *   pnpm bench --profile            add --cpu-prof to the last run of each case (bench/.prof)
 *   pnpm bench --keep               keep the generated repositories
 *
 * The CLI runs as a child process from packages/cli/bin/testwitness.js so Node
 * start up is part of the wall time. Peak RSS comes from process.resourceUsage
 * inside the child (bench/rss-hook.cjs, preloaded with -r), which is exact and
 * portable, unlike /usr/bin/time which is not on every runner.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpus, platform, release, tmpdir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, LARGE, SMALL, type GenerateResult } from './generate.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUDGET_MS: Record<string, number> = { large: 30_000, small: 5_000 };

interface Args {
  only?: string;
  runs: number;
  prefix: string[];
  enforce: boolean;
  profile: boolean;
  keep: boolean;
  build: boolean;
  work: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { runs: 3, prefix: [], enforce: false, profile: false, keep: false, build: true, work: join(tmpdir(), 'testwitness-bench'), out: join(ROOT, 'bench', 'results.json') };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    const next = () => argv[++i] ?? '';
    if (x === '--') continue;
    if (x === '--only') a.only = next();
    else if (x === '--runs') a.runs = Number(next());
    else if (x === '--prefix') a.prefix = next().split(/\s+/).filter(Boolean);
    else if (x === '--enforce') a.enforce = true;
    else if (x === '--profile') a.profile = true;
    else if (x === '--keep') a.keep = true;
    else if (x === '--no-build') a.build = false;
    else if (x === '--work') a.work = resolve(next());
    else if (x === '--out') a.out = resolve(next());
    else throw new Error(`unknown argument ${x}`);
  }
  return a;
}

interface RunSample {
  wallMs: number;
  maxRssMb: number | null;
  userCpuMs: number | null;
  systemCpuMs: number | null;
  exitCode: number | null;
  state: string;
  findings: number;
  byRule: Record<string, number>;
  engine: { totalMs: number; parseMs: number; rulesMs: number } | null;
  stderrTail: string;
}

interface CaseResult {
  name: string;
  budgetMs: number;
  generateMs: number;
  gen: GenerateResult;
  runs: RunSample[];
  medianWallMs: number;
  bestWallMs: number;
  maxRssMb: number | null;
  overBudget: boolean;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function runOnce(gen: GenerateResult, args: Args, profile: boolean, tag: string): Promise<RunSample> {
  const outFile = join(args.work, `${tag}.report.json`);
  rmSync(outFile, { force: true });
  const nodeArgs = ['-r', join(ROOT, 'bench', 'rss-hook.cjs')];
  if (profile) {
    const dir = join(ROOT, 'bench', '.prof');
    mkdirSync(dir, { recursive: true });
    nodeArgs.push('--cpu-prof', '--cpu-prof-dir', dir, '--cpu-prof-name', `${tag}.cpuprofile`);
  }
  const cli = [join(ROOT, 'packages', 'cli', 'bin', 'testwitness.js'), 'check', '--cwd', gen.repo, '--base', gen.baseSha, '--head', gen.headSha, '--junit', gen.junitGlob, '--format', 'json', '--out', outFile, '--quiet'];
  const cmd = [...args.prefix, process.execPath, ...nodeArgs, ...cli];
  const t0 = performance.now();
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let usageJson = '';
  let stderr = '';
  (child.stdio[3] as NodeJS.ReadableStream).on('data', (d: Buffer) => (usageJson += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
  const exitCode = await new Promise<number | null>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => res(code));
  });
  const wallMs = performance.now() - t0;
  let usage: { maxRSSKb: number; userCpuUs: number; systemCpuUs: number } | undefined;
  try {
    usage = JSON.parse(usageJson);
  } catch {
    usage = undefined;
  }
  let state = 'unknown';
  let findings = 0;
  const byRule: Record<string, number> = {};
  let engine: RunSample['engine'] = null;
  if (existsSync(outFile)) {
    const report = JSON.parse(readFileSync(outFile, 'utf8')) as { state: string; findings: { ruleId: string }[]; timing: { totalMs: number; parseMs: number; rulesMs: number } };
    state = report.state;
    findings = report.findings.length;
    for (const f of report.findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    engine = { totalMs: report.timing.totalMs, parseMs: report.timing.parseMs, rulesMs: report.timing.rulesMs };
  }
  return {
    wallMs,
    maxRssMb: usage ? Math.round(usage.maxRSSKb / 1024) : null,
    userCpuMs: usage ? Math.round(usage.userCpuUs / 1000) : null,
    systemCpuMs: usage ? Math.round(usage.systemCpuUs / 1000) : null,
    exitCode,
    state,
    findings,
    byRule,
    engine,
    stderrTail: stderr.slice(-400),
  };
}

function fmtRule(byRule: Record<string, number>): string {
  return Object.entries(byRule)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cpu = cpus();
  const cores = cpu.length;
  const machine = `${cores} core${cores === 1 ? '' : 's'}, ${cpu[0]?.model.trim() ?? 'unknown cpu'}, ${platform()} ${release()}, node ${process.version}`;
  process.stdout.write(`testwitness bench on ${machine}\n`);
  if (args.prefix.length) process.stdout.write(`command prefix: ${args.prefix.join(' ')}\n`);

  if (args.build) {
    process.stdout.write('building (pnpm tsc -b)\n');
    execFileSync('pnpm', ['tsc', '-b'], { cwd: ROOT, stdio: 'inherit' });
  }
  mkdirSync(args.work, { recursive: true });

  const cases: { name: string; opts: typeof LARGE }[] = [
    { name: 'large', opts: LARGE },
    { name: 'small', opts: SMALL },
  ].filter((c) => !args.only || c.name === args.only);

  const results: CaseResult[] = [];
  for (const c of cases) {
    const dir = join(args.work, c.name);
    const g0 = performance.now();
    const gen = generate({ ...c.opts, dir });
    const generateMs = Math.round(performance.now() - g0);
    process.stdout.write(`\n${c.name}: ${gen.files} files (${gen.testFiles} test files, ${gen.tests} tests at head), ${gen.xmlFiles} XML files, ${(gen.xmlBytes / 1048576).toFixed(1)} MB, generated in ${(generateMs / 1000).toFixed(1)} s\n`);
    process.stdout.write(`  mutations: ${gen.mutations.deleted} deleted, ${gen.mutations.skipped} skipped, ${gen.mutations.loosened} loosened, ${gen.mutations.newWithoutAssertion} new without assertion, ${gen.mutations.neutralTests} neutral test edits, ${gen.mutations.production} production edits\n`);
    const runs: RunSample[] = [];
    for (let i = 0; i < args.runs; i++) {
      const s = await runOnce(gen, args, args.profile && i === args.runs - 1, `${c.name}-${i + 1}`);
      runs.push(s);
      process.stdout.write(`  run ${i + 1}: ${(s.wallMs / 1000).toFixed(2)} s wall, ${s.maxRssMb ?? '?'} MB peak RSS, cpu ${s.userCpuMs ?? '?'}+${s.systemCpuMs ?? '?'} ms, exit ${s.exitCode}, ${s.state}, ${s.findings} findings${s.engine ? ` (engine ${s.engine.totalMs} ms: parse ${s.engine.parseMs}, rules ${s.engine.rulesMs})` : ''}\n`);
      if (s.exitCode !== 0 || s.state === 'unknown') process.stdout.write(`  stderr: ${s.stderrTail.trim()}\n`);
    }
    const budgetMs = BUDGET_MS[c.name] ?? Infinity;
    const medianWallMs = median(runs.map((r) => r.wallMs));
    const rss = runs.map((r) => r.maxRssMb).filter((x): x is number => x !== null);
    results.push({
      name: c.name,
      budgetMs,
      generateMs,
      gen,
      runs,
      medianWallMs,
      bestWallMs: Math.min(...runs.map((r) => r.wallMs)),
      maxRssMb: rss.length ? Math.max(...rss) : null,
      overBudget: medianWallMs > budgetMs,
    });
    if (!args.keep) rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write('\n| case  | files | tests | xml MB | median s | best s | budget s | peak RSS MB | findings | by rule |\n');
  process.stdout.write('|-------|------:|------:|-------:|---------:|-------:|---------:|------------:|---------:|---------|\n');
  for (const r of results) {
    const last = r.runs[r.runs.length - 1]!;
    process.stdout.write(
      `| ${r.name.padEnd(5)} | ${pad(r.gen.files, 5)} | ${pad(r.gen.tests, 5)} | ${pad((r.gen.xmlBytes / 1048576).toFixed(1), 6)} | ${pad((r.medianWallMs / 1000).toFixed(2), 8)} | ${pad((r.bestWallMs / 1000).toFixed(2), 6)} | ${pad((r.budgetMs / 1000).toFixed(0), 8)} | ${pad(r.maxRssMb ?? '?', 11)} | ${pad(last.findings, 8)} | ${fmtRule(last.byRule)} |\n`,
    );
  }
  process.stdout.write(`\nmachine: ${machine}\n`);

  const out = { generatedAt: new Date().toISOString(), machine: { cores, model: cpu[0]?.model.trim() ?? null, platform: platform(), release: release(), node: process.version }, prefix: args.prefix, runs: args.runs, cases: results };
  mkdirSync(resolve(args.out, '..'), { recursive: true });
  writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`results written to ${args.out}\n`);

  const over = results.filter((r) => r.overBudget);
  if (over.length) {
    process.stdout.write(`over budget: ${over.map((r) => `${r.name} (${(r.medianWallMs / 1000).toFixed(2)} s > ${r.budgetMs / 1000} s)`).join(', ')}\n`);
    if (args.enforce) process.exitCode = 1;
  } else {
    process.stdout.write('all cases within budget\n');
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? err}\n`);
  process.exitCode = 1;
});
