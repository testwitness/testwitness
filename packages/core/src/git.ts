import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toLf } from './eol.js';

const run = promisify(execFile);

export interface GitOptions {
  cwd: string;
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
    const { stdout } = await run('git', args, { cwd: opts.cwd, maxBuffer, encoding: 'utf8' });
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
 * editing it shows only the real edits, as on LF.
 */
export const DIFF_FLAGS = ['--find-renames', '--ignore-cr-at-eol'] as const;

/** Raw unified diff with rename detection and zero context. */
export async function rawDiff(base: string, head: string, opts: GitOptions): Promise<string> {
  return git(
    ['diff', ...DIFF_FLAGS, '--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', base, head, '--'],
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
    if (err instanceof GitError && /does not exist|exists on disk, but not in|bad object|Path .* does not exist/i.test(err.stderr)) {
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
