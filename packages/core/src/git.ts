import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { toLf } from './eol.js';

const run = promisify(execFile);

export interface GitOptions {
  cwd: string;
  /** Environment of the git process; default the environment of this process. Set by the working tree snapshot. */
  env?: NodeJS.ProcessEnv | undefined;
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Run a git command and return stdout. Never passes untrusted text as a flag: callers pass refs and paths after `--`. */
export async function git(args: string[], opts: GitOptions, maxBuffer = 256 * 1024 * 1024): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd: opts.cwd, maxBuffer, encoding: 'utf8', ...(opts.env ? { env: opts.env } : {}) });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new GitError(`git ${args.join(' ')} failed: ${e.stderr ?? e.message ?? 'unknown error'}`, args, e.stderr ?? '');
  }
}

export async function mergeBase(base: string, head: string, opts: GitOptions): Promise<string> {
  const out = await git(['merge-base', base, head], opts);
  return out.trim();
}

export async function revParse(ref: string, opts: GitOptions): Promise<string> {
  return (await git(['rev-parse', '--verify', `${ref}^{commit}`], opts)).trim();
}

/**
 * Diff options every diff the engine reads shares. --ignore-cr-at-eol: a line whose only change is CRLF to LF (or
 * back) is not a change, so a PR that converts line endings shows no hunks, and one that converts a file while
 * editing it shows only the real edits, as on LF. --no-ext-diff and --no-textconv: both are commands from the git
 * config that a .gitattributes line of the repository can select, and the engine reads text as it is stored.
 */
export const DIFF_FLAGS = ['--find-renames', '--ignore-cr-at-eol', '--no-ext-diff', '--no-textconv'] as const;

/** Raw unified diff with rename detection and zero context. */
export async function rawDiff(base: string, head: string, opts: GitOptions): Promise<string> {
  return git(
    ['diff', ...DIFF_FLAGS, '--unified=0', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', base, head, '--'],
    opts,
  );
}

/** Numstat for binary detection and line counts. */
export async function numstat(base: string, head: string, opts: GitOptions): Promise<Map<string, { added: number | null; deleted: number | null }>> {
  const out = await git(['diff', ...DIFF_FLAGS, '--numstat', '-z', base, head, '--'], opts);
  const result = new Map<string, { added: number | null; deleted: number | null }>();
  // -z format: "added\tdeleted\tpath\0" or for renames "added\tdeleted\t\0old\0new\0"
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const [a, d, p] = rec.split('\t');
    if (a === undefined || d === undefined) continue;
    const added = a === '-' ? null : Number(a);
    const deleted = d === '-' ? null : Number(d);
    if (p === '' || p === undefined) {
      // rename: next two parts are old and new
      const newPath = parts[i + 2];
      i += 2;
      if (newPath) result.set(newPath, { added, deleted });
    } else {
      result.set(p, { added, deleted });
    }
  }
  return result;
}

/**
 * Read a file at a ref, with LF line endings (eol.ts): front ends, rules and the config parser then see the same
 * text for a file committed with CRLF as for its LF twin. Returns undefined when the path does not exist at that ref.
 */
export async function showFile(ref: string, path: string, opts: GitOptions): Promise<string | undefined> {
  try {
    return toLf(await git(['show', `${ref}:${path}`], opts));
  } catch (err) {
    if (err instanceof GitError && /does not exist|exists on disk, but not in|bad object|Path .* does not exist/i.test(err.stderr.slice(0, 8192))) {
      return undefined;
    }
    throw err;
  }
}

/** List all files at a ref. */
export async function listTree(ref: string, opts: GitOptions): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', '-z', ref], opts);
  return out.split('\0').filter(Boolean);
}

/** Commit messages between base and head, for provenance detection. */
export async function commitMessages(base: string, head: string, opts: GitOptions): Promise<string[]> {
  const out = await git(['log', '--format=%B%x00', `${base}..${head}`], opts);
  return out.split('\0').map((s) => s.trim()).filter(Boolean);
}

export interface WorktreeSnapshot {
  /** Id of a tree object that holds the working tree: staged, unstaged and untracked files that are not ignored. */
  tree: string;
  /** Options every git call that reads the tree must use: the tree lives in a temporary object directory. */
  git: GitOptions;
  /** Remove the temporary index and object directory. */
  dispose(): void;
}

/**
 * Snapshot the working tree as a git tree object without writing anything into the repository.
 *
 * How: a temporary directory under os.tmpdir() holds a copy of the index (GIT_INDEX_FILE) and an empty object
 * directory (GIT_OBJECT_DIRECTORY); the repository's own object directory is added read only through
 * GIT_ALTERNATE_OBJECT_DIRECTORIES. `git add -A` then stages every change into the temporary index, writing new blobs
 * into the temporary object directory, and `git write-tree` writes the tree there too. The repository's index, refs,
 * object store and working tree are not touched: no temporary commit, no stash, not even a loose object. The tree is
 * what `git add -A && git commit` would record (same ignore rules, same line ending and clean filters), so the engine
 * sees exactly what a commit of the current state would hold. One consequence: a clean filter the user has configured
 * in git (Git LFS, git-crypt) runs as it does for `git add`; it comes from the user's git config, never from the
 * repository's files. Git hooks and fsmonitor programs are switched off for the snapshot. The tree can only be read through the returned options
 * and is gone after dispose().
 *
 * Why not read the files directly: the engine's rename detection, binary detection and hunks come from `git diff`, and
 * findings must be identical to the commit check once the change is committed. One code path guarantees that.
 */
/** Snapshot directories still on disk; removed when the process exits early (the agent hook exits on its timeout). */
const liveSnapshots = new Set<string>();
let exitHookInstalled = false;

export async function snapshotWorktree(opts: GitOptions): Promise<WorktreeSnapshot> {
  const top = (await git(['rev-parse', '--show-toplevel'], opts)).trim();
  const paths = (await git(['rev-parse', '--git-path', 'objects', '--git-path', 'index'], { ...opts, cwd: top })).split('\n');
  const objects = resolve(top, paths[0] ?? '');
  const index = resolve(top, paths[1] ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'testwitness-worktree-'));
  liveSnapshots.add(dir);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => {
      for (const d of liveSnapshots) rmSync(d, { recursive: true, force: true });
    });
  }
  const dispose = (): void => {
    rmSync(dir, { recursive: true, force: true });
    liveSnapshots.delete(dir);
  };
  try {
    const tmpIndex = join(dir, 'index');
    mkdirSync(join(dir, 'objects'));
    const base = opts.env ?? process.env;
    const alternates = [objects, base['GIT_ALTERNATE_OBJECT_DIRECTORIES']].filter(Boolean).join(delimiter);
    // No git hook and no fsmonitor program may run while the snapshot is taken: `git add` writes an index, which would
    // start a post-index-change hook, and refreshing it would start a configured fsmonitor. Both are switched off for
    // every git call that uses this environment, through git's config-from-environment variables.
    mkdirSync(join(dir, 'no-hooks'));
    const n = Number(base['GIT_CONFIG_COUNT'] ?? 0) || 0;
    const env: NodeJS.ProcessEnv = {
      ...base,
      GIT_INDEX_FILE: tmpIndex,
      GIT_OBJECT_DIRECTORY: join(dir, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_COUNT: String(n + 2),
      [`GIT_CONFIG_KEY_${n}`]: 'core.hooksPath',
      [`GIT_CONFIG_VALUE_${n}`]: join(dir, 'no-hooks'),
      [`GIT_CONFIG_KEY_${n + 1}`]: 'core.fsmonitor',
      [`GIT_CONFIG_VALUE_${n + 1}`]: 'false',
    };
    const snap: GitOptions = { cwd: top, env };
    const stage = async (): Promise<void> => {
      await git(['add', '-A', '--', '.'], snap);
    };
    // The copied index keeps git's stat cache, so unchanged files are not hashed again.
    let staged = false;
    if (existsSync(index)) {
      copyFileSync(index, tmpIndex);
      try {
        await stage();
        staged = true;
      } catch {
        // A split or otherwise unusual index cannot be used from a copy: start from HEAD instead.
        rmSync(tmpIndex, { force: true });
      }
    }
    if (!staged) {
      try {
        await git(['read-tree', 'HEAD'], snap);
      } catch {
        /* no commit yet: start from an empty index */
      }
      await stage();
    }
    const tree = (await git(['write-tree'], snap)).trim();
    return { tree, git: snap, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}
