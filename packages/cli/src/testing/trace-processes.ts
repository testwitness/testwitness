// Test helper for the "never executes the repository's code" promise: records every child process this Node process
// starts, and every command git itself runs.
//
//   * Node level: ChildProcess.prototype.spawn is the one door spawn, exec, execFile and fork go through; spawnSync,
//     execFileSync and execSync are wrapped as well.
//   * git level: GIT_TRACE makes git log each built in command it runs and each external program it starts
//     ("trace: run_command:" and "trace: exec:"), into a file the test reads.
import childProcess, { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export interface ProcessTrace {
  /** Programs this process started, as "file arg arg ...". */
  spawned: string[];
  /** The lines git wrote to GIT_TRACE. */
  gitTrace: string[];
  /** git's built in subcommands that ran, such as "rev-parse". */
  gitBuiltins: string[];
  /** Programs git itself started (hooks, filters, pagers, editors, external diff). */
  gitExternal: string[];
}

export async function traceProcesses(fn: () => Promise<void>): Promise<ProcessTrace> {
  const dir = mkdtempSync(join(tmpdir(), 'tw-trace-'));
  const traceFile = join(dir, 'git-trace.log');
  const spawned: string[] = [];
  const proto = ChildProcess.prototype as unknown as { spawn(options: { file?: string; args?: string[] }): unknown };
  const originalSpawn = proto.spawn;
  proto.spawn = function (this: unknown, options) {
    spawned.push([basename(options.file ?? '?'), ...(options.args ?? []).slice(1)].join(' '));
    return originalSpawn.call(this, options);
  };
  const cp = childProcess as unknown as Record<string, (...a: unknown[]) => unknown>;
  const syncNames = ['spawnSync', 'execFileSync', 'execSync'];
  const originals = syncNames.map((n) => cp[n]!);
  syncNames.forEach((n, i) => {
    cp[n] = (...a: unknown[]) => {
      spawned.push(`${n}: ${String(a[0])} ${Array.isArray(a[1]) ? a[1].join(' ') : ''}`.trim());
      return originals[i]!(...a);
    };
  });
  syncBuiltinESMExports();
  const before = process.env['GIT_TRACE'];
  process.env['GIT_TRACE'] = traceFile;
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env['GIT_TRACE'];
    else process.env['GIT_TRACE'] = before;
    proto.spawn = originalSpawn;
    syncNames.forEach((n, i) => (cp[n] = originals[i]!));
    syncBuiltinESMExports();
  }
  let gitTrace: string[] = [];
  try {
    gitTrace = readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    /* git wrote nothing */
  }
  rmSync(dir, { recursive: true, force: true });
  const gitBuiltins = gitTrace.flatMap((l) => /trace: built-in: git (\S+)/.exec(l)?.[1] ?? []);
  const gitExternal = gitTrace.filter((l) => /trace: (run_command|exec|start_command|alias expansion):/.test(l));
  return { spawned, gitTrace, gitBuiltins, gitExternal };
}
