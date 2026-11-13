/**
 * Working tree replay: each corpus entry is materialised as an uncommitted change on top of its base commit (the way
 * a coding agent leaves it), checked with `check --worktree`, then committed and checked commit to commit. The two
 * runs must give the same findings with the same fingerprints.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, type CheckResult } from 'testwitness';
import type { Finding, Report } from '@testwitness/core';
import type { CorpusEntry } from './corpus.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'corpus', GIT_AUTHOR_EMAIL: 'corpus@testwitness.local', GIT_COMMITTER_NAME: 'corpus', GIT_COMMITTER_EMAIL: 'corpus@testwitness.local' };
// Signing is off: these throwaway commits must not depend on the machine's signing setup.
const git = (cwd: string, args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });

export interface ReplayResult {
  /** `check --worktree` on the uncommitted change. */
  worktree: Report;
  /** The commit to commit check after the same change was committed. */
  commit: Report;
  /** Whatever `inWorktree` returned while the change was still uncommitted. */
  extra?: unknown;
  /** `git status --porcelain` and the object count before and after the working tree check: proof nothing was written. */
  untouched: boolean;
}

/** What a finding is, without the parts that may differ between two runs of the same change (none today). */
export function findingKey(f: Finding): string {
  return JSON.stringify([f.ruleId, f.severity, f.fingerprint, f.location.path, f.location.line ?? null, f.message, f.label ?? null, f.before ?? null, f.after ?? null]);
}

function repoState(repo: string): string {
  return [git(repo, ['status', '--porcelain=v1', '-uall']), git(repo, ['count-objects', '-v']), git(repo, ['for-each-ref']), git(repo, ['stash', 'list'])].join('\n---\n');
}

export async function replayEntry(e: CorpusEntry, inWorktree?: (repo: string, result: CheckResult) => Promise<unknown>): Promise<ReplayResult> {
  const repo = mkdtempSync(join(tmpdir(), `tw-replay-${e.slug}-`));
  try {
    git(repo, ['init', '-q', '-b', 'main']);
    const base = join(e.dir, 'files', 'base');
    const head = join(e.dir, 'files', 'head');
    if (existsSync(base)) cpSync(base, repo, { recursive: true });
    writeFileSync(join(repo, '.gitkeep'), '');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    const baseSha = git(repo, ['rev-parse', 'HEAD']).trim();
    // The change as an agent leaves it: deleted, edited and new files in the working tree, nothing staged.
    for (const m of e.manifest) {
      if (m.status === 'deleted') rmSync(join(repo, m.path), { force: true });
      if (m.status === 'renamed' && m.oldPath) rmSync(join(repo, m.oldPath), { force: true });
    }
    if (existsSync(head)) cpSync(head, repo, { recursive: true });
    const bodyFile = join(e.dir, 'pr-body.md');
    const common = { cwd: repo, junit: 'none/**/*.xml', format: 'json' as const, quiet: true, log: () => {}, prTitle: e.meta.title ?? '', ...(existsSync(bodyFile) ? { prBodyFile: bodyFile } : {}) };
    const before = repoState(repo);
    const wt = await check({ ...common, base: baseSha, head: 'HEAD', worktree: true });
    const untouched = repoState(repo) === before;
    const extra = inWorktree ? await inWorktree(repo, wt) : undefined;
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'head', '--allow-empty']);
    const committed = await check({ ...common, base: baseSha, head: git(repo, ['rev-parse', 'HEAD']).trim() });
    return { worktree: wt.report, commit: committed.report, untouched, ...(extra !== undefined ? { extra } : {}) };
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** Run `fn` over `items` with at most `n` in flight; results keep the order of `items`. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
