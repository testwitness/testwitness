import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check, render, ConfigError } from './check.js';
import { builtinRules, GitError, TOOL_VERSION } from '@testwitness/core';

export { check, render } from './check.js';
export { allFrontEnds } from './frontends.js';

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program.name('testwitness').description('Did this PR weaken its tests, and did they actually run?').version(TOOL_VERSION);
  let code = 0;

  program
    .command('check')
    .description('Compare base and head, read JUnit XML, report findings')
    .option('--base <ref>', 'base ref (merge base is computed)', 'origin/main')
    .option('--head <ref>', 'head ref', 'HEAD')
    .option('--junit <globs>', 'comma separated globs of JUnit XML files (default from config)')
    .option('--config <path>', 'path to .testwitness.yml (default: base ref, then working tree)')
    .option('--format <fmt>', 'json | markdown | both', 'markdown')
    .option('--out <path>', 'write the output to a file instead of stdout')
    .option('--mode <mode>', 'report | require-ack | strict (overrides config)')
    .option('--fail-on <sev>', 'high | medium | low (overrides config)')
    .option('--pr-title <title>', 'pull request title, for claim checks')
    .option('--pr-body-file <path>', 'file holding the pull request body')
    .option('--cwd <dir>', 'repository directory', process.cwd())
    .option('-q, --quiet', 'no progress on stderr', false)
    .action(async (o) => {
      try {
        const { report, exitCode, config } = await check({
          cwd: resolve(o.cwd),
          base: o.base,
          head: o.head,
          junit: o.junit,
          config: o.config,
          format: o.format,
          out: o.out,
          prTitle: o.prTitle,
          prBodyFile: o.prBodyFile,
          mode: o.mode,
          failOn: o.failOn,
          quiet: o.quiet,
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
    .command('rules')
    .description('List built in rules')
    .action(() => {
      for (const r of builtinRules()) process.stdout.write(`${r.id}  ${r.defaultSeverity.padEnd(6)}  ${r.name}\n`);
    });

  await program.parseAsync(argv, { from: 'user' });
  return code;
}
