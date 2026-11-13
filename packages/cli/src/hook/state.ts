// Loop guard state of the agent hook: how often each finding has blocked in one agent session. Kept in a per user
// directory under os.tmpdir(), keyed by repository and session, never in the repository: a file in the checkout is
// something the agent's own change could carry, and it would show up in `git status`.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function defaultStateDir(): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return join(tmpdir(), `testwitness-hook-${uid}`);
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function stateFile(dir: string, repo: string, session: string): string {
  let real = repo;
  try {
    real = realpathSync(repo);
  } catch {
    /* keep the path as given */
  }
  return join(dir, `${hash(real)}-${hash(session)}.json`);
}

/** The directory is usable when it is a real directory owned by this user (a shared temp dir can hold a planted link). */
function usable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    return true;
  } catch {
    return false;
  }
}

export interface BlockCounts {
  [fingerprint: string]: number;
}

/** Block counts of this session; empty when there is no state, or it cannot be read. */
export function readCounts(dir: string, repo: string, session: string): BlockCounts {
  if (!usable(dir)) return {};
  try {
    const doc: unknown = JSON.parse(readFileSync(stateFile(dir, repo, session), 'utf8'));
    const blocks = (doc as { blocks?: unknown }).blocks;
    if (typeof blocks !== 'object' || blocks === null) return {};
    const out: BlockCounts = {};
    for (const [k, v] of Object.entries(blocks)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Write the counts (atomically) and drop state files of sessions older than a week. Returns false when it could not be written. */
export function writeCounts(dir: string, repo: string, session: string, counts: BlockCounts, now = Date.now()): boolean {
  if (!usable(dir)) return false;
  try {
    const file = stateFile(dir, repo, session);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, updated: new Date(now).toISOString(), blocks: counts }) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try {
        if (now - statSync(p).mtimeMs > MAX_AGE_MS) rmSync(p, { force: true });
      } catch {
        /* another hook removed it */
      }
    }
    return true;
  } catch {
    return false;
  }
}
