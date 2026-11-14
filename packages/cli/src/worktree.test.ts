// `check --worktree`: the head side is the working tree (staged, unstaged, untracked and not ignored), read without
// writing anything into the repository. The corpus replay (corpus/runner/replay.test.ts) proves it equals the commit check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotWorktree, git as runGit } from '@testwitness/core';
import { check } from './check.js';
import { main } from './index.js';
import { makeRepo, MATH_TEST_WEAKENED, type TestRepo } from './testing/repo.js';

let repo: TestRepo | undefined;
afterEach(() => {
  repo?.dispose();
  repo = undefined;
});

const opts = (dir: string) => ({ cwd: dir, base: 'main', head: 'HEAD', worktree: true, results: '', format: 'json' as const, quiet: true, log: () => {} });
const ids = (r: { findings: { ruleId: string; location: { path: string } }[] }) => r.findings.filter((f) => f.ruleId !== 'V005').map((f) => `${f.ruleId} ${f.location.path}`).sort();

describe('check --worktree', () => {
  it('sees unstaged, staged and untracked changes, and not ignored files', async () => {
    repo = makeRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED); // unstaged edit
    repo.remove('src/other.test.ts'); // staged deletion
    repo.git('add', '-A', 'src/other.test.ts');
    repo.write('src/new.test.ts', "import { it } from 'vitest';\n\nit('asserts nothing', () => {\n  add(1, 2);\n});\n"); // untracked
    repo.write('ignored/x.test.ts', "import { it } from 'vitest';\n\nit('ignored', () => {});\n");
    const before = repo.state();
    const { report } = await check(opts(repo.dir));
    expect(repo.state()).toBe(before);
    expect(ids(report)).toEqual(['A002 src/math.test.ts', 'O001 src/new.test.ts', 'R002 src/other.test.ts', 'R003 src/math.test.ts']);
    expect(report.headTree).toMatch(/^[0-9a-f]{40}$/);
    expect(report.head).toBe(repo.git('rev-parse', 'HEAD').trim());
    expect(report.files.changed).toBe(3);
  });

  it('gives the findings of the commit check once the same change is committed', async () => {
    repo = makeRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const wt = await check(opts(repo.dir));
    repo.git('checkout', '-q', '-b', 'work');
    repo.git('commit', '-q', '-am', 'weaken');
    const committed = await check({ ...opts(repo.dir), worktree: false });
    expect(wt.report.findings.map((f) => f.fingerprint)).toEqual(committed.report.findings.map((f) => f.fingerprint));
    expect(wt.report.findings.length).toBeGreaterThan(1);
    // A clean tree on top of the commit still shows the branch's findings: the comparison is with the merge base.
    const clean = await check(opts(repo.dir));
    expect(clean.report.findings.map((f) => f.fingerprint)).toEqual(committed.report.findings.map((f) => f.fingerprint));
  });

  it('reports nothing on a clean tree at the base', async () => {
    repo = makeRepo();
    const { report } = await check(opts(repo.dir));
    expect(report.files.changed).toBe(0);
    expect(ids(report)).toEqual([]);
  });

  it('works from a linked worktree and from a subdirectory', async () => {
    repo = makeRepo();
    const linked = join(dirname(repo.dir), `${basename(repo.dir)}-linked`);
    repo.git('worktree', 'add', '-q', '-b', 'linked', linked);
    try {
      writeFileSync(join(linked, 'src/math.test.ts'), MATH_TEST_WEAKENED);
      const before = repo.state();
      const { report } = await check(opts(linked));
      expect(ids(report)).toEqual(['A002 src/math.test.ts', 'R003 src/math.test.ts']);
      expect(repo.state()).toBe(before);
      const sub = await check(opts(join(linked, 'src')));
      expect(ids(sub.report)).toEqual(ids(report));
    } finally {
      repo.git('worktree', 'remove', '--force', linked);
    }
  });

  it('keeps the snapshot outside the repository and removes it', async () => {
    repo = makeRepo();
    repo.write('src/brand-new.ts', 'export const x = 1;\n');
    const snap = await snapshotWorktree({ cwd: repo.dir });
    const objects = snap.git.env?.['GIT_OBJECT_DIRECTORY'] ?? '';
    try {
      expect(existsSync(objects)).toBe(true);
      expect(snap.git.env?.['GIT_OBJECT_DIRECTORY']?.startsWith(tmpdir())).toBe(true);
      expect(await runGit(['ls-tree', '-r', '--name-only', snap.tree], snap.git)).toContain('src/brand-new.ts');
      // The tree and the new blob do not exist in the repository's own object store.
      expect(() => repo!.git('cat-file', '-e', snap.tree)).toThrow();
    } finally {
      snap.dispose();
    }
    expect(existsSync(objects)).toBe(false);
  });

  it('works before the first commit of a branch has an index, and with a staged rename', async () => {
    repo = makeRepo();
    repo.git('mv', 'src/other.test.ts', 'src/renamed.test.ts');
    const { report } = await check(opts(repo.dir));
    expect(report.files.changed).toBe(1);
    expect(ids(report)).toEqual([]);
  });

  it('is a CLI flag, and refuses --head with it', async () => {
    repo = makeRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    mkdirSync(join(repo.dir, 'out'));
    expect(await main(['check', '--worktree', '--cwd', repo.dir, '--format', 'json', '--out', 'out/r.json', '--results', '', '-q'])).toBe(0);
    const report = JSON.parse(readFileSync(join(repo.dir, 'out/r.json'), 'utf8')) as { headTree?: string; findings: unknown[] };
    expect(report.headTree).toBeDefined();
    expect(report.findings.length).toBeGreaterThan(1);
    expect(await main(['check', '--worktree', '--head', 'main', '--cwd', repo.dir, '-q'])).toBe(2);
  });
});
