// The three promises, tested on the hook:
//   * no network (criterion 6): this file and hook.test.ts run with every socket, DNS and fetch door replaced by one
//     that throws; here the guard is also shown to trip, so a silent pass cannot hide a broken guard.
//   * no execution of the repository's code (criterion 7): every child process is traced while the hook handles a
//     commit, a stop, a protected edit and a pre-push on a repository full of traps; only git may run, only with the
//     local subcommands listed below, and git itself may start nothing.
//   * config from the base only: the traps include a working tree .testwitness.yml.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runHook } from './run.js';
import { init } from '../init.js';
import { makeRepo, MATH_TEST_WEAKENED, TMP } from '../testing/repo.js';
import { installNetworkGuard } from '../testing/no-network.js';
import { traceProcesses } from '../testing/trace-processes.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/hooks');
const network = installNetworkGuard();
let expectedAttempts = 0;
afterAll(() => {
  // Only the deliberate attempts of the first test below; the hook made none.
  expect(network.attempts()).toHaveLength(expectedAttempts);
  network.restore();
});

/** git subcommands the engine and the hook may run. All of them read the local repository; none talks to a remote. */
const LOCAL_GIT = ['rev-parse', 'merge-base', 'symbolic-ref', 'diff', 'show', 'ls-tree', 'log', 'add', 'read-tree', 'write-tree', 'cat-file'];
// cat-file --batch (the blob reader) reads stored objects as they are; unlike show with --textconv or --filters it runs no
// program from the git config or .gitattributes.

describe('no network', () => {
  it('the guard trips on a socket, a DNS lookup and a fetch', async () => {
    expect(() => net.connect(9, '127.0.0.1')).toThrow(/network access is disabled/);
    expect(() => dns.lookup('example.com', () => {})).toThrow(/network access is disabled/);
    await expect((async () => fetch('http://127.0.0.1:9/'))()).rejects.toThrow(/network access is disabled/);
    expectedAttempts = 3;
    expect(network.attempts()).toHaveLength(3);
  });
});

describe('no execution of the repository', () => {
  it('only git runs, with local subcommands, and git starts nothing, on a repository full of traps', async () => {
    const marker = join(mkdtempSync(join(TMP, 'tw-trap-')), 'executed');
    const trap = `#!/bin/sh\necho "$0" >> "${marker}"\n`;
    const repo = makeRepo({ '.testwitness.yml': 'protect:\n  - "src/other.test.ts"\n' });
    const stateDir = mkdtempSync(join(TMP, 'tw-safety-state-'));
    try {
      // Traps in the repository's files: anything that installs, imports or runs project code would fire one.
      repo.write('package.json', JSON.stringify({ name: 'trap', scripts: { preinstall: `touch ${marker}`, test: `touch ${marker}`, prepare: `touch ${marker}` } }));
      repo.write('vitest.config.ts', `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'vitest config');\nexport default {};\n`);
      repo.write('jest.config.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'jest config');\nmodule.exports = {};\n`);
      repo.write('conftest.py', `open(${JSON.stringify(marker)}, 'w').write('conftest')\n`);
      repo.write('Makefile', `test:\n\ttouch ${marker}\n`);
      repo.write('.husky/pre-commit', trap);
      repo.write('.gitattributes', '*.ts diff=trap\n');
      repo.write('.testwitness.yml', 'rules:\n  A002: off\n  R003: off\nprotect: []\n');
      repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
      // Traps in the git directory and the git config: hooks, an fsmonitor program, an external diff and a textconv.
      for (const hook of ['post-index-change', 'pre-commit', 'post-checkout', 'reference-transaction', 'pre-push', 'fsmonitor-watchman']) {
        const p = join(repo.dir, '.git/hooks', hook);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, trap);
        chmodSync(p, 0o755);
      }
      const script = join(dirname(marker), 'trap.sh');
      writeFileSync(script, trap);
      chmodSync(script, 0o755);
      repo.git('config', 'core.fsmonitor', script);
      repo.git('config', 'diff.external', script);
      repo.git('config', 'diff.trap.textconv', script);
      repo.git('config', 'core.pager', script);
      repo.git('config', 'core.editor', script);
      rmSync(marker, { force: true }); // git config and the setup above may have fired the fsmonitor trap already
      repo.git('checkout', '-q', '-b', 'work', '--no-guess');
      rmSync(marker, { force: true });
      const sha = repo.git('rev-parse', 'HEAD').trim();
      rmSync(marker, { force: true });

      const payload = (agent: string, name: string): string => readFileSync(join(fixtures, agent, name), 'utf8').replaceAll('__REPO__', JSON.stringify(repo.dir).slice(1, -1)).replace('__LOCAL_SHA__', sha);
      const results: Array<{ block: boolean; note?: string | undefined }> = [];
      const trace = await traceProcesses(async () => {
        for (const [agent, name] of [
          ['claude', 'pretooluse-bash-git-commit.json'],
          ['claude', 'stop.json'],
          ['claude', 'pretooluse-edit.json'],
          ['cursor', 'before-shell-execution-git-commit.json'],
          ['cursor', 'stop.json'],
          ['codex', 'pretooluse-apply-patch.json'],
          ['codex', 'stop.json'],
          ['git', 'pre-push.txt'],
        ] as const) {
          const r = await runHook({ agent, input: payload(agent, name), cwd: repo.dir, stateDir: mkdtempSync(join(stateDir, 's-')) });
          results.push({ block: r.decision.block, note: r.decision.note });
        }
        await init({ agent: 'git', cwd: repo.dir, command: 'testwitness', force: true });
        await init({ agent: 'claude', cwd: repo.dir, command: 'testwitness' });
      });

      // The hook did its job: the working tree checks blocked (the working tree config that turns the rules off was
      // ignored), the edits passed (math.test.ts is not on the base protect list), the clean pre-push passed.
      expect(results.map((r) => r.block)).toEqual([true, true, false, true, true, false, true, false]);
      expect(results.every((r) => !/crashed|timed out|could not/.test(r.note ?? ''))).toBe(true);

      // Node started git and nothing else.
      expect(trace.spawned.length).toBeGreaterThan(20);
      expect(trace.spawned.filter((s) => !s.startsWith('git '))).toEqual([]);
      // git ran local built in subcommands only.
      expect(trace.gitBuiltins.length).toBeGreaterThan(20);
      expect([...new Set(trace.gitBuiltins)].filter((b) => !LOCAL_GIT.includes(b))).toEqual([]);
      for (const never of ['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote', 'commit', 'stash', 'checkout', 'reset', 'update-ref', 'config', 'gc']) expect(trace.gitBuiltins).not.toContain(never);
      // git started no program of its own: no hook, no fsmonitor, no external diff, no textconv, no pager.
      expect(trace.gitExternal).toEqual([]);
      // And no trap fired.
      expect(existsSync(marker), existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe(false);
    } finally {
      repo.dispose();
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(dirname(marker), { recursive: true, force: true });
    }
  }, 60_000);
});
