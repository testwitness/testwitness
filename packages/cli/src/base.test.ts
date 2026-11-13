import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitError, renderMarkdown } from '@testwitness/core';
import { check, resolveBase } from './check.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Maple Ridge', GIT_AUTHOR_EMAIL: 'maple@example.test', GIT_COMMITTER_NAME: 'Maple Ridge', GIT_COMMITTER_EMAIL: 'maple@example.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim();

/** A repository on `master` whose feature branch, deleting a test, was merged with a merge commit. */
function mergedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-cli-base-'));
  git(dir, 'init', '-q', '-b', 'master');
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'test/a.test.ts'), "import { expect, test } from 'vitest';\ntest('a', () => { expect(1).toBe(1); });\ntest('b', () => { expect(2).toBe(2); });\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, 'test/a.test.ts'), "import { expect, test } from 'vitest';\ntest('a', () => { expect(1).toBe(1); });\n");
  git(dir, 'commit', '-q', '-am', 'delete test b');
  git(dir, 'checkout', '-q', 'master');
  git(dir, 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature');
  return dir;
}

describe('base ref and empty comparisons', () => {
  it('reports nothing to compare, not pass, when the head is already in the base', async () => {
    const dir = mergedRepo();
    try {
      const { report } = await check({ cwd: dir, base: 'master', head: 'feature', format: 'json', quiet: true });
      expect(report.files.changed).toBe(0);
      expect(report.state).toBe('unreadable');
      expect(report.notes?.[0]).toMatch(/^Nothing to compare: /);
      expect(renderMarkdown(report)).toMatch(/Nothing to compare/);
      // The merge commit's first parent is the right base once the PR is merged.
      const real = await check({ cwd: dir, base: 'master^1', head: 'feature', format: 'json', quiet: true });
      expect(real.report.notes).toBeUndefined();
      expect(real.report.findings.some((f) => f.ruleId === 'R001')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults the base to the default branch and names it when a given base does not resolve', async () => {
    const dir = mergedRepo();
    try {
      expect(await resolveBase(dir, undefined)).toBe('master');
      const err = await check({ cwd: dir, base: 'origin/main', head: 'feature', format: 'json', quiet: true }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/origin\/main does not name a commit.*default branch is master.*--base master/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
