import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check, defaultFormat, loadConfig, render, resolveBase, useColor, ConfigError } from './check.js';
import { serveStdio } from './mcp.js';
import { AGENTS } from './hook/events.js';
import { runHook } from './hook/run.js';
import { init } from './init.js';
import { preparePr, type PrDeps } from './pr.js';
import { builtinRules, GitError, planMutation, renderMutationPlanShell, TOOL_VERSION, writeFileNoFollow } from '@testwitness/core';

export { check, render } from './check.js';
export { allFrontEnds } from './frontends.js';
export { createServer } from './mcp.js';

export { runHook, evaluate } from './hook/run.js';
export { init } from './init.js';
export { parsePrUrl } from './pr.js';

/** All of stdin as text; empty when stdin is a terminal. */
async function readStdin(timeoutMs: number): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  await new Promise<void>((done) => {
    // An agent that never closes stdin must not hang the hook: answer with what arrived.
    const timer = setTimeout(done, timeoutMs);
    process.stdin.on('data', (c: Buffer | string) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    process.stdin.on('end', () => (clearTimeout(timer), done()));
    process.stdin.on('error', () => (clearTimeout(timer), done()));
  });
  return Buffer.concat(chunks).toString('utf8');
}

/** Options of --pr that make no sense in a trial run: it compares the pull request itself and reads no local files. */
const NOT_WITH_PR: Array<[key: string, flag: string]> = [
  ['base', '--base'],
  ['worktree', '--worktree'],
  ['results', '--results'],
  ['junit', '--junit'],
  ['coverage', '--coverage'],
  ['mutation', '--mutation'],
];

export interface MainDeps {
  /** For tests: where --pr fetches from and how it reads the REST API. */
  pr?: PrDeps;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const program = new Command();
  program.name('testwitness').description('Did this PR weaken its tests, and did they actually run?').version(TOOL_VERSION);
  let code = 0;

  program
    .command('check')
    .description('Compare base and head, read the test results, report findings')
    .option('--base <ref>', "base ref (merge base is computed; default: origin's default branch, from origin/HEAD)")
    .option('--head <ref>', 'head ref', 'HEAD')
    .option('--worktree', 'compare the merge base with the working tree (staged, unstaged and untracked files that are not ignored) instead of the head commit; writes nothing into the repository')
    .option('--results <globs>', 'comma separated globs of test results: JUnit XML, TAP, or Jest, Vitest, pytest-json-report or Playwright JSON (default from config)')
    .option('--junit <globs>', 'older name of --results; used when --results is not given')
    .option('--diff-only', 'check the diff and the PR text only: read no test results and skip V005 (for local runs and existing PRs)', false)
    .option('--coverage <globs>', 'comma separated globs of lcov, Cobertura or JaCoCo coverage reports (default from config coverage.paths)')
    .option('--mutation <globs>', 'comma separated globs of Stryker JSON or PIT mutations.xml reports from the opt in mutation job (default from config mutation.paths)')
    .option('--config <path>', 'path to .testwitness.yml (default: the merge base, then a local uncommitted file; never one the change adds)')
    .option('--format <fmt>', 'text | markdown | json | both (default: text at a terminal, markdown otherwise)')
    .option('--out <path>', 'write the output to a file instead of stdout')
    .option('--mode <mode>', 'report | require-ack | strict (overrides config)')
    .option('--fail-on <sev>', 'high | medium | low (overrides config)')
    .option('--pr-title <title>', 'pull request title, for claim checks')
    .option('--pr-body-file <path>', 'file holding the pull request body')
    .option('--author <login>', 'pull request author login, shown in provenance')
    .option('--author-type <type>', 'pull request author account type, for example User or Bot')
    .option('--follow-symlinks', 'follow symbolic links in the results, coverage and mutation paths (for Bazel style layouts; default from config paths.followSymlinks, off)')
    .option('--pr <url>', 'trial run on a public pull request, https://github.com/<owner>/<repo>/pull/<n>: fetches it with git (into this clone, or a cached blobless clone) and checks the diff only (docs/cli.md)')
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .option('-q, --quiet', 'no progress on stderr', false)
    .action(async (o) => {
      try {
        const format = defaultFormat({ format: o.format, out: o.out, isTTY: Boolean(process.stdout.isTTY) });
        if (o.worktree && o.head !== 'HEAD') throw new ConfigError('--worktree compares the working tree, which sits on HEAD; do not pass --head with it');
        if (o.pr !== undefined) {
          code = await checkPr(o, format, deps.pr);
          return;
        }
        const { report, exitCode, config } = await check({
          cwd: resolve(o.cwd),
          base: o.base,
          head: o.head,
          ...(o.worktree ? { worktree: true } : {}),
          results: o.results,
          junit: o.junit,
          ...(o.diffOnly ? { diffOnly: true } : {}),
          coverage: o.coverage,
          mutation: o.mutation,
          config: o.config,
          format,
          out: o.out,
          prTitle: o.prTitle,
          prBodyFile: o.prBodyFile,
          author: o.author,
          authorType: o.authorType,
          mode: o.mode,
          failOn: o.failOn,
          quiet: o.quiet,
          ...(o.followSymlinks ? { followSymlinks: true } : {}),
        });
        const text = render(report, format, config.comment.collapseLow, !o.out && useColor(process.env, Boolean(process.stdout.isTTY)));
        if (o.out) await writeFileNoFollow(resolve(o.cwd, o.out), text);
        else process.stdout.write(text);
        code = exitCode;
      } catch (err) {
        if (err instanceof ConfigError || err instanceof GitError) {
          process.stderr.write(`testwitness: ${err.message}\n`);
          code = 2;
        } else throw err;
      }
    });

  program
    .command('mutate-plan')
    .description('Print the changed production files and the Stryker and PIT settings that mutate only them. Runs nothing.')
    .option('--base <ref>', "base ref (merge base is computed; default: origin's default branch, from origin/HEAD)")
    .option('--head <ref>', 'head ref', 'HEAD')
    .option('--config <path>', 'path to .testwitness.yml (default: the merge base, then a local uncommitted file; never one the change adds)')
    .option('--format <fmt>', 'json | shell', 'json')
    .option('--out <path>', 'write the plan to a file instead of stdout')
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .action(async (o) => {
      try {
        if (o.format !== 'json' && o.format !== 'shell') throw new ConfigError('--format must be json or shell');
        const cwd = resolve(o.cwd);
        const base = await resolveBase(cwd, o.base);
        const config = await loadConfig({ cwd, base, head: o.head, config: o.config, format: 'json' });
        const plan = await planMutation({ cwd, base, head: o.head, config });
        const text = o.format === 'shell' ? renderMutationPlanShell(plan) : JSON.stringify(plan, null, 2) + '\n';
        if (o.out) await writeFileNoFollow(resolve(cwd, o.out), text);
        else process.stdout.write(text);
      } catch (err) {
        if (err instanceof ConfigError || err instanceof GitError) {
          process.stderr.write(`testwitness: ${err.message}\n`);
          code = 2;
        } else throw err;
      }
    });

  program
    .command('rules')
    .description('List built in rules')
    .action(() => {
      for (const r of builtinRules()) process.stdout.write(`${r.id}  ${r.defaultSeverity.padEnd(6)}  ${r.name}\n`);
    });

  program
    .command('hook')
    .description("Guard for a coding agent's hooks: reads the hook event on stdin, checks the working tree on commit, push and stop, and answers in the agent's blocking format (docs/agent-guard.md)")
    .requiredOption('--agent <name>', `${AGENTS.join(' | ')}`)
    .option('--base <ref>', "base ref (merge base is computed); default the repository's default branch")
    .option('--timeout <seconds>', 'give up and allow the action after this many seconds (default hook.timeout from the base config, then 20)')
    .option('--results <globs>', 'comma separated globs of test results to read (default none)')
    .option('--cwd <dir>', 'directory to use when the event names none', process.cwd())
    .allowExcessArguments(true)
    .action(async (o) => {
      if (!(AGENTS as readonly string[]).includes(o.agent)) {
        process.stderr.write(`testwitness: --agent must be one of ${AGENTS.join(', ')}\n`);
        code = 2;
        return;
      }
      const timeout = o.timeout === undefined ? undefined : Number(o.timeout);
      const out = await runHook({ agent: o.agent, input: await readStdin(5000), cwd: resolve(o.cwd), base: o.base, results: o.results, ...(timeout !== undefined && timeout > 0 ? { timeoutSeconds: timeout } : {}) });
      // Flush both streams, then leave: after a timeout the check may still be running, and the answer is already out.
      await new Promise<void>((done) => process.stderr.write(out.stderr, () => done()));
      await new Promise<void>((done) => process.stdout.write(out.stdout, () => done()));
      process.exit(out.exitCode);
    });

  program
    .command('init')
    .description("Write the hook config that puts testwitness hook into a coding agent's loop (or a git pre-push hook); writes nothing else and is safe to run twice")
    .requiredOption('--agent <name>', `${AGENTS.join(' | ')}`)
    .option('--command <cmd>', 'how the hook starts testwitness (default: testwitness when it is on PATH, else npx --no-install testwitness)')
    .option('--force', 'with --agent git: replace a different existing pre-push hook', false)
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .action(async (o) => {
      if (!(AGENTS as readonly string[]).includes(o.agent)) {
        process.stderr.write(`testwitness: --agent must be one of ${AGENTS.join(', ')}\n`);
        code = 2;
        return;
      }
      const result = await init({ agent: o.agent, cwd: resolve(o.cwd), force: o.force, command: o.command });
      process.stdout.write(result.lines.map((l) => `${l}\n`).join(''));
      code = result.exitCode;
    });

  program
    .command('mcp')
    .description('Start a read only MCP server on stdio (tools: testwitness_check, testwitness_explain_rule, testwitness_rules)')
    .action(async () => {
      await serveStdio();
    });

  await program.parseAsync(argv, { from: 'user' });
  return code;
}

/** `check --pr <url>`: fetch first (the only network use), then the usual offline check on a read only view. */
async function checkPr(o: Record<string, unknown>, format: ReturnType<typeof defaultFormat>, deps: PrDeps | undefined): Promise<number> {
  for (const [key, flag] of NOT_WITH_PR) if (o[key] !== undefined && o[key] !== false) throw new ConfigError(`--pr is a trial run on the pull request alone; do not pass ${flag} with it`);
  if (o['head'] !== 'HEAD') throw new ConfigError('--pr is a trial run on the pull request alone; do not pass --head with it');
  const cwd = resolve(String(o['cwd']));
  const quiet = Boolean(o['quiet']);
  const log = (s: string): void => {
    if (!quiet) process.stderr.write(`testwitness: ${s}\n`);
  };
  const pr = await preparePr(String(o['pr']), cwd, log, deps);
  try {
    if (pr.location.kind === 'cache') {
      const where = pr.location.reused ? `using the cached clone in ${pr.location.dir}` : `kept the clone in ${pr.location.dir} for the next run`;
      log(`${where}; delete it with: rm -rf ${pr.location.dir}`);
    } else {
      const ns = `refs/testwitness/pr/${pr.pr.number}`;
      log(`fetched ${pr.pr.url} into this clone as ${ns}/head and ${ns}/base; remove them with: git update-ref -d ${ns}/head && git update-ref -d ${ns}/base`);
    }
    const bodyFile = o['prBodyFile'] === undefined ? undefined : await readFile(resolve(cwd, String(o['prBodyFile'])), 'utf8');
    const title = o['prTitle'] === undefined ? pr.title : String(o['prTitle']);
    const body = bodyFile ?? pr.body;
    const { report, exitCode, config } = await check({
      cwd: pr.cwd,
      base: pr.base,
      head: pr.head,
      diffOnly: true,
      diffOnlyNotes: pr.notes,
      configFromBaseOnly: true,
      helperIndex: false,
      results: '',
      coverage: '',
      mutation: '',
      ...(o['config'] !== undefined ? { config: resolve(cwd, String(o['config'])) } : {}),
      format,
      ...(title !== undefined ? { prTitle: title } : {}),
      ...(body !== undefined ? { prBody: body } : {}),
      author: o['author'] as string | undefined,
      authorType: o['authorType'] as string | undefined,
      mode: o['mode'] as never,
      failOn: o['failOn'] as never,
      quiet,
      log,
    });
    const out = o['out'] === undefined ? undefined : String(o['out']);
    const text = render(report, format, config.comment.collapseLow, !out && useColor(process.env, Boolean(process.stdout.isTTY)));
    if (out) await writeFileNoFollow(resolve(cwd, out), text);
    else process.stdout.write(text);
    return exitCode;
  } finally {
    pr.dispose();
  }
}
