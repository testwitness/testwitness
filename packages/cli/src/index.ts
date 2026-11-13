import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check, loadConfig, render, ConfigError } from './check.js';
import { serveStdio } from './mcp.js';
import { builtinRules, GitError, planMutation, renderMutationPlanShell, TOOL_VERSION } from '@testwitness/core';

export { check, render } from './check.js';
export { allFrontEnds } from './frontends.js';
export { createServer } from './mcp.js';

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program.name('testwitness').description('Did this PR weaken its tests, and did they actually run?').version(TOOL_VERSION);
  let code = 0;

  program
    .command('check')
    .description('Compare base and head, read the test results, report findings')
    .option('--base <ref>', 'base ref (merge base is computed)', 'origin/main')
    .option('--head <ref>', 'head ref', 'HEAD')
    .option('--results <globs>', 'comma separated globs of test results: JUnit XML, TAP, or Jest, Vitest, pytest-json-report or Playwright JSON (default from config)')
    .option('--junit <globs>', 'older name of --results; used when --results is not given')
    .option('--coverage <globs>', 'comma separated globs of lcov, Cobertura or JaCoCo coverage reports (default from config coverage.paths)')
    .option('--mutation <globs>', 'comma separated globs of Stryker JSON or PIT mutations.xml reports from the opt in mutation job (default from config mutation.paths)')
    .option('--config <path>', 'path to .testwitness.yml (default: base ref, then working tree)')
    .option('--format <fmt>', 'json | markdown | both', 'markdown')
    .option('--out <path>', 'write the output to a file instead of stdout')
    .option('--mode <mode>', 'report | require-ack | strict (overrides config)')
    .option('--fail-on <sev>', 'high | medium | low (overrides config)')
    .option('--pr-title <title>', 'pull request title, for claim checks')
    .option('--pr-body-file <path>', 'file holding the pull request body')
    .option('--author <login>', 'pull request author login, shown in provenance')
    .option('--author-type <type>', 'pull request author account type, for example User or Bot')
    .option('--history <file>', 'run history JSON from earlier runs; severities then depend on what tests did before (docs/history.md)')
    .option('--history-out <file>', 'write the run history with this run merged in')
    .option('--run-id <id>', 'id of this run in the history (default GITHUB_RUN_ID, then local-<head sha>)')
    .option('--follow-symlinks', 'follow symbolic links in the results, coverage, mutation and history paths (for Bazel style layouts; default from config paths.followSymlinks, off)')
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .option('-q, --quiet', 'no progress on stderr', false)
    .action(async (o) => {
      try {
        const { report, exitCode, config } = await check({
          cwd: resolve(o.cwd),
          base: o.base,
          head: o.head,
          results: o.results,
          junit: o.junit,
          coverage: o.coverage,
          mutation: o.mutation,
          config: o.config,
          format: o.format,
          out: o.out,
          prTitle: o.prTitle,
          prBodyFile: o.prBodyFile,
          author: o.author,
          authorType: o.authorType,
          mode: o.mode,
          failOn: o.failOn,
          quiet: o.quiet,
          history: o.history,
          historyOut: o.historyOut,
          runId: o.runId,
          ...(o.followSymlinks ? { followSymlinks: true } : {}),
        });
        const text = render(report, o.format, config.comment.collapseLow);
        if (o.out) await writeFile(resolve(o.cwd, o.out), text);
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
    .option('--base <ref>', 'base ref (merge base is computed)', 'origin/main')
    .option('--head <ref>', 'head ref', 'HEAD')
    .option('--config <path>', 'path to .testwitness.yml (default: base ref, then working tree)')
    .option('--format <fmt>', 'json | shell', 'json')
    .option('--out <path>', 'write the plan to a file instead of stdout')
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .action(async (o) => {
      try {
        if (o.format !== 'json' && o.format !== 'shell') throw new ConfigError('--format must be json or shell');
        const cwd = resolve(o.cwd);
        const config = await loadConfig({ cwd, base: o.base, head: o.head, config: o.config, format: 'json' });
        const plan = await planMutation({ cwd, base: o.base, head: o.head, config });
        const text = o.format === 'shell' ? renderMutationPlanShell(plan) : JSON.stringify(plan, null, 2) + '\n';
        if (o.out) await writeFile(resolve(cwd, o.out), text);
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
    .command('mcp')
    .description('Start a read only MCP server on stdio (tools: testwitness_check, testwitness_explain_rule, testwitness_rules)')
    .action(async () => {
      await serveStdio();
    });

  await program.parseAsync(argv, { from: 'user' });
  return code;
}
