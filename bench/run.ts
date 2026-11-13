/**
 * Benchmark runner.
 *
 *   pnpm bench                      build, generate the 100, 1,000 and 5,000 file repositories, run each three times
 *   pnpm bench --only 1000          one case (also --sizes 100,1000)
 *   pnpm bench --runs 5             more samples
 *   pnpm bench --enforce            exit 1 when a median is over its time budget, peak RSS is over 1.5 GB,
 *                                   or generating the 5,000 file case took longer than checking it
 *   pnpm bench --prefix "unshare -rn"      wrap the CLI invocation (network off); also read from BENCH_PREFIX
 *                                   (an environment variable survives the Windows shell, an empty argument does not)
 *   pnpm bench --profile            add --cpu-prof to the last run of each case (bench/.prof)
 *   pnpm bench --keep               keep the generated repositories
 *   pnpm bench --work DIR           where generated repositories go (default $TMPDIR/testwitness-bench, or BENCH_WORK)
 *   pnpm bench --reuse              reuse a generated case in --work when its generator hash matches (CI cache)
 *   pnpm bench --out FILE --summary FILE    where to write the JSON results and a markdown table
 *
 * Budgets (wall, median of the runs): 100 files 5 s, 1,000 files 30 s, 5,000 files 120 s; peak RSS 1.5 GB.
 *
 * The CLI runs as a child process from packages/cli/bin/testwitness.js so Node
 * start up is part of the wall time. Peak RSS comes from process.resourceUsage
 * inside the child (bench/rss-hook.cjs, preloaded with -r), which is exact and
 * portable, unlike /usr/bin/time which is not on every runner.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, generatorHash, SIZES, type GenerateResult, type SizeName } from './generate.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// BENCH_BUDGET_SCALE is only for trying the gate (0.01 makes every case fail); CI never sets it.
const BUDGET_SCALE = Number(process.env.BENCH_BUDGET_SCALE || 1);
const BUDGET_MS: Record<string, number> = { '100': 5_000 * BUDGET_SCALE, '1000': 30_000 * BUDGET_SCALE, '5000': 120_000 * BUDGET_SCALE };
const BUDGET_RSS_MB = 1536;

interface Args {
  only?: string;
  runs: number;
  prefix: string[];
  enforce: boolean;
  profile: boolean;
  keep: boolean;
  reuse: boolean;
  summary?: string;
  build: boolean;
  work: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { runs: 3, prefix: (process.env.BENCH_PREFIX ?? '').split(/\s+/).filter(Boolean), enforce: false, profile: false, keep: false, reuse: false, build: true, work: resolve(process.env.BENCH_WORK || join(tmpdir(), 'testwitness-bench')), out: join(ROOT, 'bench', 'results.json') };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    const next = () => argv[++i] ?? '';
    if (x === '--') continue;
    if (x === '--only' || x === '--sizes') a.only = next();
    else if (x === '--runs') a.runs = Number(next());
    else if (x === '--prefix') a.prefix = next().split(/\s+/).filter(Boolean);
    else if (x === '--enforce') a.enforce = true;
    else if (x === '--profile') a.profile = true;
    else if (x === '--keep') a.keep = true;
    else if (x === '--reuse') a.reuse = true;
    else if (x === '--summary') a.summary = resolve(next());
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
  /** One minute load average of the machine when the run started: a high value means other work shared the cores. */
  loadAvg1: number;
  state: string;
  findings: number;
  byRule: Record<string, number>;
  engine: { totalMs: number; parseMs: number; rulesMs: number } | null;
  /** The reader stopped at its byte cap on results, so part of the XML was never read and the case is not measuring what it claims. */
  resultsCapped: boolean;
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
  generateCached: boolean;
  budgetRssMb: number;
  overBudget: boolean;
  overRss: boolean;
  /** Generation took longer than the check itself (only enforced for the 5,000 file case). */
  generateSlowerThanCheck: boolean;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function runOnce(gen: GenerateResult, args: Args, profile: boolean, tag: string): Promise<RunSample> {
  const outFile = join(args.work, `${tag}.report.json`);
  const usageFile = join(args.work, `${tag}.usage.json`);
  rmSync(outFile, { force: true });
  rmSync(usageFile, { force: true });
  const nodeArgs = ['-r', join(ROOT, 'bench', 'rss-hook.cjs')];
  if (profile) {
    const dir = join(ROOT, 'bench', '.prof');
    mkdirSync(dir, { recursive: true });
    nodeArgs.push('--cpu-prof', '--cpu-prof-dir', dir, '--cpu-prof-name', `${tag}.cpuprofile`);
  }
  const cli = [join(ROOT, 'packages', 'cli', 'bin', 'testwitness.js'), 'check', '--cwd', gen.repo, '--base', gen.baseSha, '--head', gen.headSha, '--junit', gen.junitGlob, '--format', 'json', '--out', outFile, '--quiet'];
  const cmd = [...args.prefix, process.execPath, ...nodeArgs, ...cli];
  const loadAvg1 = Math.round(loadavg()[0]! * 100) / 100;
  const t0 = performance.now();
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TW_BENCH_USAGE_FILE: usageFile } });
  let stderr = '';
  child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
  const exitCode = await new Promise<number | null>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => res(code));
  });
  const wallMs = performance.now() - t0;
  let usage: { maxRSSKb: number; userCpuUs: number; systemCpuUs: number } | undefined;
  try {
    usage = JSON.parse(readFileSync(usageFile, 'utf8'));
  } catch {
    usage = undefined;
  }
  let state = 'unknown';
  let findings = 0;
  const byRule: Record<string, number> = {};
  let engine: RunSample['engine'] = null;
  let resultsCapped = false;
  if (existsSync(outFile)) {
    const report = JSON.parse(readFileSync(outFile, 'utf8')) as { state: string; findings: { ruleId: string }[]; timing: { totalMs: number; parseMs: number; rulesMs: number }; evidence: { notes: string[] } };
    state = report.state;
    findings = report.findings.length;
    for (const f of report.findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    resultsCapped = report.evidence.notes.some((n) => n.includes('cap on results'));
    engine = { totalMs: report.timing.totalMs, parseMs: report.timing.parseMs, rulesMs: report.timing.rulesMs };
  }
  return {
    wallMs,
    maxRssMb: usage ? Math.round(usage.maxRSSKb / 1024) : null,
    userCpuMs: usage ? Math.round(usage.userCpuUs / 1000) : null,
    systemCpuMs: usage ? Math.round(usage.systemCpuUs / 1000) : null,
    exitCode,
    loadAvg1,
    state,
    findings,
    byRule,
    engine,
    resultsCapped,
    stderrTail: stderr.slice(-400),
  };
}

function fmtRule(byRule: Record<string, number>): string {
  return Object.entries(byRule)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cpu = cpus();
  const cores = cpu.length;
  const machine = `${cores} core${cores === 1 ? '' : 's'}, ${cpu[0]?.model.trim() ?? 'unknown cpu'}, ${platform()} ${release()}, node ${process.version}`;
  process.stdout.write(`testwitness bench on ${machine}\n`);
  if (args.prefix.length) process.stdout.write(`command prefix: ${args.prefix.join(' ')}\n`);

  if (args.build) {
    process.stdout.write('building (tsc -b)\n');
    // Run the compiler through node: on Windows pnpm is a .cmd shim that execFile cannot start.
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-b'], { cwd: ROOT, stdio: 'inherit' });
  }
  mkdirSync(args.work, { recursive: true });

  const wanted = args.only ? args.only.split(',').map((x) => x.trim()) : Object.keys(SIZES);
  const unknown = wanted.filter((w) => !(w in SIZES));
  if (unknown.length) throw new Error(`unknown size ${unknown.join(', ')}; use ${Object.keys(SIZES).join(', ')}`);
  const cases = wanted.map((name) => ({ name: name as SizeName, opts: SIZES[name as SizeName] }));
  const genSource = readFileSync(join(ROOT, 'bench', 'generate.ts'), 'utf8');

  const results: CaseResult[] = [];
  for (const c of cases) {
    const dir = join(args.work, c.name);
    const hash = generatorHash(c.opts, genSource);
    const marker = join(dir, '.generated.json');
    let gen: GenerateResult | undefined;
    let generateCached = false;
    const g0 = performance.now();
    if (args.reuse && existsSync(marker)) {
      try {
        const m = JSON.parse(readFileSync(marker, 'utf8')) as { hash: string; gen: GenerateResult };
        if (m.hash === hash && existsSync(m.gen.repo) && existsSync(m.gen.junitDir)) {
          gen = m.gen;
          generateCached = true;
        }
      } catch {
        gen = undefined;
      }
    }
    if (!gen) {
      gen = generate({ ...c.opts, dir });
      writeFileSync(marker, JSON.stringify({ hash, gen }));
    }
    const generateMs = Math.round(performance.now() - g0);
    process.stdout.write(`\n${c.name}: ${gen.files} files (${gen.testFiles} test files, ${gen.tests} tests at head), ${gen.xmlFiles} XML files, ${(gen.xmlBytes / 1048576).toFixed(1)} MB, ${generateCached ? 'reused from cache' : 'generated'} in ${(generateMs / 1000).toFixed(1)} s (generator ${hash})\n`);
    process.stdout.write(`  mutations: ${gen.mutations.deleted} deleted, ${gen.mutations.skipped} skipped, ${gen.mutations.loosened} loosened, ${gen.mutations.newWithoutAssertion} new without assertion, ${gen.mutations.neutralTests} neutral test edits, ${gen.mutations.production} production edits\n`);
    const runs: RunSample[] = [];
    for (let i = 0; i < args.runs; i++) {
      const s = await runOnce(gen, args, args.profile && i === args.runs - 1, `${c.name}-${i + 1}`);
      runs.push(s);
      process.stdout.write(`  run ${i + 1}: ${(s.wallMs / 1000).toFixed(2)} s wall, ${s.maxRssMb ?? '?'} MB peak RSS, cpu ${s.userCpuMs ?? '?'}+${s.systemCpuMs ?? '?'} ms, load ${s.loadAvg1}, exit ${s.exitCode}, ${s.state}, ${s.findings} findings${s.engine ? ` (engine ${s.engine.totalMs} ms: parse ${s.engine.parseMs}, rules ${s.engine.rulesMs})` : ''}\n`);
      if (s.exitCode !== 0 || s.state === 'unknown') process.stdout.write(`  stderr: ${s.stderrTail.trim()}\n`);
    }
    const budgetMs = BUDGET_MS[c.name] ?? Infinity;
    const medianWallMs = median(runs.map((r) => r.wallMs));
    const failedRuns = runs.filter((r) => r.exitCode !== 0 || r.state === 'unknown').length;
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
      generateCached,
      budgetRssMb: BUDGET_RSS_MB,
      // A run that crashed or produced no report is a failure, not a fast pass.
      overBudget: medianWallMs > budgetMs || failedRuns > 0 || runs.some((x) => x.resultsCapped),
      overRss: rss.length ? Math.max(...rss) > BUDGET_RSS_MB : false,
      generateSlowerThanCheck: c.name === '5000' && generateMs > medianWallMs,
    });
    if (!args.keep && !args.reuse) rmSync(dir, { recursive: true, force: true });
  }

  const verdicts = results.map((r) => {
    const problems: string[] = [];
    if (r.medianWallMs > r.budgetMs) problems.push(`median ${(r.medianWallMs / 1000).toFixed(2)} s over ${r.budgetMs / 1000} s`);
    if (r.runs.some((x) => x.exitCode !== 0 || x.state === 'unknown')) problems.push('a run failed or wrote no report');
    if (r.runs.some((x) => x.resultsCapped)) problems.push('results hit the reader byte cap, XML was not fully read');
    if (r.overRss) problems.push(`peak RSS ${r.maxRssMb} MB over ${r.budgetRssMb} MB`);
    if (r.generateSlowerThanCheck) problems.push(`generation ${(r.generateMs / 1000).toFixed(1)} s took longer than the check ${(r.medianWallMs / 1000).toFixed(1)} s`);
    return { name: r.name, problems };
  });
  const failing = verdicts.filter((v) => v.problems.length);

  const rows = results.map((r) => {
    const last = r.runs[r.runs.length - 1]!;
    const v = verdicts.find((x) => x.name === r.name)!;
    return { r, last, ok: v.problems.length === 0 };
  });
  const table = [
    '| files | tests | xml MB | gen s | median s | best s | budget s | peak RSS MB | RSS budget MB | findings | by rule | result |',
    '|------:|------:|-------:|------:|---------:|-------:|---------:|------------:|--------------:|---------:|---------|--------|',
    ...rows.map(({ r, last, ok }) => `| ${r.name} | ${r.gen.tests} | ${(r.gen.xmlBytes / 1048576).toFixed(0)} | ${(r.generateMs / 1000).toFixed(1)}${r.generateCached ? ' (cached)' : ''} | ${(r.medianWallMs / 1000).toFixed(2)} | ${(r.bestWallMs / 1000).toFixed(2)} | ${r.budgetMs / 1000} | ${r.maxRssMb ?? '?'} | ${r.budgetRssMb} | ${last.findings} | ${fmtRule(last.byRule)} | ${ok ? 'pass' : 'FAIL'} |`),
  ].join('\n');
  process.stdout.write(`\n${table}\n`);
  process.stdout.write(`\nmachine: ${machine}\n`);

  const out = {
    generatedAt: new Date().toISOString(),
    machine: { cores, model: cpu[0]?.model.trim() ?? null, platform: platform(), release: release(), memoryMb: Math.round(totalmem() / 1048576), node: process.version },
    prefix: args.prefix,
    runs: args.runs,
    cases: results,
  };
  mkdirSync(resolve(args.out, '..'), { recursive: true });
  writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`results written to ${args.out}\n`);
  if (args.summary) {
    mkdirSync(resolve(args.summary, '..'), { recursive: true });
    const lines = [`### ${platform()} (${machine})`, '', table, '', failing.length ? `Over budget: ${failing.map((f) => `${f.name} files, ${f.problems.join('; ')}`).join('. ')}` : 'All sizes within budget.', ''];
    writeFileSync(args.summary, lines.join('\n'));
  }

  if (failing.length) {
    process.stdout.write(`over budget: ${failing.map((f) => `${f.name} files (${f.problems.join('; ')})`).join(', ')}\n`);
    if (args.enforce) process.exitCode = 1;
  } else {
    process.stdout.write('all cases within budget\n');
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? err}\n`);
  process.exitCode = 1;
});
