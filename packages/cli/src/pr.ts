// The zero install trial: `testwitness check --pr https://github.com/<owner>/<repo>/pull/<n>`.
//
// This is the only code in testwitness that talks to the network, and it runs before the engine, only when --pr is
// given. It fetches with git (a blobless partial clone, or a fetch into the current clone) plus at most one
// unauthenticated GET to the GitHub REST API for the title, body and base branch. It never reads, asks for or stores a
// token, never starts gh, and never runs anything from the fetched repository: every git call switches hooks, LFS
// filters, credential helpers and extra HTTP headers off, nothing is checked out, and files are read as blobs.
//
// The engine then runs on a read only view: a fresh, empty bare repository whose object store borrows the fetched
// objects through objects/info/alternates. The view has no remote, so git cannot lazily fetch a missing blob from
// inside the engine: a blob that was not fetched up front reads as missing. The blobs the engine reads (the changed
// files, their sibling and namesake files, files at the root and the agent hook configs) are fetched before it runs.
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { builtinRules, ConfigError, GitError, HOOK_CONFIG_PATHS } from '@testwitness/core';

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  /** https://github.com/<owner>/<repo>/pull/<number>, rebuilt from the parts (never the input text). */
  url: string;
}

/** What the REST API said about the pull request. Data, never instructions. */
export interface PullRequestMeta {
  title: string;
  body: string;
  baseRef: string;
  headSha: string;
}

export type ApiResult = { ok: true; meta: PullRequestMeta } | { ok: false; reason: string };

export interface PrDeps {
  /** The git URL to fetch owner/repo from. Default https://github.com/<owner>/<repo>.git; tests pass a local bare repository. */
  remoteUrl?: (owner: string, repo: string) => string;
  /** The one REST call. Default: an unauthenticated GET to api.github.com; tests pass a stub. */
  api?: (pr: PullRequestRef) => Promise<ApiResult>;
  /** Directory that holds the cached clones. Default os.tmpdir()/testwitness-pr-clones-<uid>. */
  cacheRoot?: string;
}

export interface PreparedPr {
  pr: PullRequestRef;
  /** Directory of the read only view the engine runs in. */
  cwd: string;
  /** Merge base of the PR head and the base branch. */
  base: string;
  /** The PR head commit. */
  head: string;
  baseRef: string;
  title?: string;
  body?: string;
  /** Lines for the report's evidence notes. */
  notes: string[];
  /** Where the clone lives: the current repository, or the cache directory. */
  location: { kind: 'current'; dir: string } | { kind: 'cache'; dir: string; reused: boolean };
  dispose(): void;
}

const MAX_URL = 512;
// GitHub logins: letters, digits and single hyphens, no hyphen at either end, at most 39 characters.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repository names: letters, digits, '.', '_' and '-', at most 100; never '.' or '..', never a leading '-'.
const REPO = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/;
const PR_URL = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/([0-9]+)((?:\/[A-Za-z0-9._-]+)*)\/?(?:[?#][A-Za-z0-9=&._-]*)?$/i;

const usage = 'expected https://github.com/<owner>/<repo>/pull/<number>';

/** Parse a pull request URL. The input is untrusted: anything but the one accepted shape is rejected. */
export function parsePrUrl(input: string): PullRequestRef {
  if (typeof input !== 'string') throw new ConfigError(`--pr: ${usage}`);
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_URL) throw new ConfigError(`--pr: ${text.length ? 'URL too long' : 'empty URL'}; ${usage}`);
  // Printable ASCII only: no control characters, no spaces, no look alike letters.
  if (!/^[\x21-\x7e]+$/.test(text)) throw new ConfigError(`--pr: the URL holds characters a GitHub pull request URL never has; ${usage}`);
  const m = PR_URL.exec(text);
  if (!m) throw new ConfigError(`--pr: not a GitHub pull request URL; ${usage}`);
  const [, owner = '', repo = '', num = '', rest = ''] = m;
  if (!OWNER.test(owner)) throw new ConfigError(`--pr: ${JSON.stringify(owner.slice(0, 60))} is not a GitHub owner name; ${usage}`);
  if (!REPO.test(repo) || repo === '.' || repo === '..' || /\.git$/i.test(repo)) throw new ConfigError(`--pr: ${JSON.stringify(repo.slice(0, 60))} is not a GitHub repository name; ${usage}`);
  if (rest.split('/').some((s) => s === '..' || s === '.')) throw new ConfigError(`--pr: the path after the pull request number may not hold . or ..; ${usage}`);
  if (!/^[1-9][0-9]{0,9}$/.test(num) || Number(num) > 2147483647) throw new ConfigError(`--pr: ${JSON.stringify(num.slice(0, 20))} is not a pull request number; ${usage}`);
  const number = Number(num);
  return { owner, repo, number, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

/** owner/repo of a remote URL, when it points at github.com (https, ssh or scp style), lower cased. */
export function githubRepoOf(url: string): string | undefined {
  const m =
    /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url) ??
    /^ssh:\/\/(?:[^@/]+@)?github\.com(?::22)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url) ??
    /^(?:[^@/:]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

const defaultRemoteUrl = (owner: string, repo: string): string => `https://github.com/${owner}/${repo}.git`;

/** The one unauthenticated GET. Redirects are not followed, so it stays one request to one host. */
export async function fetchPullRequestMeta(pr: PullRequestRef): Promise<ApiResult> {
  const url = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'testwitness', 'x-github-api-version': '2022-11-28' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return { ok: false, reason: `not reachable (${cause?.code ?? cause?.message ?? (err as Error).name})` };
  }
  if (!res.ok) {
    const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429;
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: limited ? 'rate limited' : `HTTP ${res.status}` };
  }
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) return { ok: false, reason: 'answer too large' };
  return parseMeta(text);
}

/** The fields we use from the REST answer, checked for shape. Everything else in it is ignored. */
export function parseMeta(text: string): ApiResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'answer is not JSON' };
  }
  const d = data as { title?: unknown; body?: unknown; base?: { ref?: unknown }; head?: { sha?: unknown } };
  const title = d?.title;
  const body = d?.body ?? '';
  const baseRef = d?.base?.ref;
  const headSha = d?.head?.sha;
  if (typeof title !== 'string' || typeof body !== 'string' || typeof baseRef !== 'string' || typeof headSha !== 'string') return { ok: false, reason: 'answer is missing fields' };
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(headSha)) return { ok: false, reason: 'answer has no head commit' };
  return { ok: true, meta: { title: title.slice(0, 1024), body: body.slice(0, 256 * 1024), baseRef, headSha } };
}

interface GitRun {
  cwd: string;
  input?: string;
  /** Protocol git may use for this call: https, or file for a local test remote. Absent: no transport at all. */
  protocol?: string;
}

/**
 * Settings on every git call of this layer. Hooks, LFS and other filters, fsmonitor, credential helpers and configured
 * extra HTTP headers (where a CI checkout keeps its token) are off; submodules are not fetched; no gc starts.
 */
const SAFE = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'credential.helper=',
  '-c', 'http.extraHeader=',
  '-c', 'http.https://github.com/.extraHeader=',
  '-c', 'filter.lfs.smudge=',
  '-c', 'filter.lfs.process=',
  '-c', 'filter.lfs.required=false',
  '-c', 'fetch.recurseSubmodules=false',
  '-c', 'submodule.recurse=false',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false',
];

function cleanEnv(protocol: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_ASKPASS', 'SSH_ASKPASS']) delete env[k];
  // A whitelist of transports: none for local commands, so even a lazy fetch cannot leave the machine.
  env['GIT_ALLOW_PROTOCOL'] = protocol ?? 'none';
  if (protocol) delete env['GIT_NO_LAZY_FETCH'];
  return env;
}

function runGit(args: string[], opts: GitRun): Promise<string> {
  const full = [...SAFE, ...args];
  return new Promise((done, fail) => {
    const proc = spawn('git', full, { cwd: opts.cwd, env: cleanEnv(opts.protocol), stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', (e) => fail(new GitError(`git ${args[0]} failed: ${e.message}`, args, '')));
    proc.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) done(Buffer.concat(out).toString('utf8'));
      else fail(new GitError(`git ${args.slice(0, 2).join(' ')} failed: ${stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`}`, args, stderr));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(opts.input ?? '');
  });
}

/** The cache root: absent (created private) or a real directory owned by this user, never a link. */
function ensureOwnDirectory(dir: string): void {
  try {
    const st = lstatSync(dir);
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (!st.isDirectory() || st.isSymbolicLink() || (uid !== undefined && st.uid !== uid)) {
      throw new ConfigError(`--pr: ${dir} exists but is not a directory owned by you; remove it, or set TMPDIR to a private directory`);
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function defaultCacheRoot(): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return join(tmpdir(), `testwitness-pr-clones-${uid}`);
}

function protocolOf(url: string): string {
  return url.startsWith('https://') ? 'https' : 'file';
}

async function isCloneOf(cwd: string, pr: PullRequestRef, url: string): Promise<boolean> {
  try {
    const origin = (await runGit(['remote', 'get-url', 'origin'], { cwd })).trim();
    if (origin === url) return true;
    return githubRepoOf(origin) === `${pr.owner}/${pr.repo}`.toLowerCase() && githubRepoOf(url) !== undefined;
  } catch {
    return false;
  }
}

/** A branch name from the API or ls-remote, accepted only when git agrees it is a valid branch name. */
async function checkBranch(name: string, cwd: string): Promise<string> {
  if (!name || name.startsWith('-') || name.length > 255 || !/^[\x21-\x7e]+$/.test(name)) throw new ConfigError(`--pr: base branch ${JSON.stringify(name.slice(0, 80))} is not a branch name testwitness accepts`);
  await runGit(['check-ref-format', `refs/heads/${name}`], { cwd }).catch(() => {
    throw new ConfigError(`--pr: base branch ${JSON.stringify(name.slice(0, 80))} is not a valid branch name`);
  });
  return name;
}

async function defaultBranch(cwd: string, remote: string, protocol: string, local: boolean): Promise<string> {
  if (local) {
    try {
      const head = (await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd })).trim();
      if (head.startsWith('refs/remotes/origin/')) return head.slice('refs/remotes/origin/'.length);
    } catch {
      /* not recorded: ask the remote */
    }
  }
  const out = await runGit(['ls-remote', '--symref', '--', remote, 'HEAD'], { cwd, protocol });
  const m = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(out);
  if (!m?.[1]) throw new GitError('--pr: could not read the default branch of the repository', ['ls-remote'], out);
  return m[1];
}

interface TreeEntry {
  type: string;
  oid: string;
  path: string;
}

async function lsTree(commit: string, cwd: string): Promise<TreeEntry[]> {
  const out = await runGit(['ls-tree', '-r', '-z', '--full-tree', commit], { cwd });
  const entries: TreeEntry[] = [];
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type = '', oid = ''] = rec.slice(0, tab).split(' ');
    entries.push({ type, oid, path: rec.slice(tab + 1) });
  }
  return entries;
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Most extra blobs (siblings and namesakes of the changed files) fetched up front; the changed files are always fetched. */
const MAX_EXTRA_BLOBS = 3000;

/**
 * The blobs the engine may read: every changed file at base and head; at head, the other files in the directories of
 * changed files (refactor and framework detection) and files with the same name as a changed file (move detection);
 * files at the root and the agent hook configs at both sides (config and workflow rules).
 */
export async function wantedBlobs(view: string, base: string, head: string): Promise<string[]> {
  const changed = new Set((await runGit(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base, head, '--'], { cwd: view })).split('\0').filter(Boolean));
  const dirs = new Set([...changed].map(dirOf));
  const names = new Set([...changed].map(nameOf));
  const must = new Set<string>();
  const extra = new Set<string>();
  const fixed = (p: string): boolean => !p.includes('/') || HOOK_CONFIG_PATHS.includes(p);
  for (const [commit, wide] of [[head, true], [base, false]] as const) {
    for (const e of await lsTree(commit, view)) {
      if (e.type !== 'blob') continue;
      if (changed.has(e.path) || fixed(e.path)) must.add(e.oid);
      else if (wide && (dirs.has(dirOf(e.path)) || names.has(nameOf(e.path)))) extra.add(e.oid);
    }
  }
  return [...must, ...[...extra].filter((o) => !must.has(o)).slice(0, MAX_EXTRA_BLOBS)];
}

async function missingObjects(view: string, oids: string[]): Promise<string[]> {
  if (!oids.length) return [];
  const out = await runGit(['cat-file', '--batch-check'], { cwd: view, input: oids.join('\n') + '\n' });
  return out.split('\n').filter((l) => l.endsWith(' missing')).map((l) => l.split(' ')[0]!);
}

/**
 * Fetch the pull request and prepare a read only view for the engine. `cwd` is where the command was started: when it
 * is a clone of the same repository, the fetch goes into it (refs/testwitness/pr/<n>/...); otherwise into a cached
 * blobless clone under the temp directory.
 */
export async function preparePr(input: string, cwd: string, log: (s: string) => void, deps: PrDeps = {}): Promise<PreparedPr> {
  const pr = parsePrUrl(input);
  const url = (deps.remoteUrl ?? defaultRemoteUrl)(pr.owner, pr.repo);
  const protocol = protocolOf(url);
  const apiP = (deps.api ?? fetchPullRequestMeta)(pr).catch((err: unknown): ApiResult => ({ ok: false, reason: (err as Error).message }));

  let repoDir: string;
  let location: PreparedPr['location'];
  let remote: string;
  if (await isCloneOf(cwd, pr, url)) {
    repoDir = (await runGit(['rev-parse', '--show-toplevel'], { cwd }).catch(() => cwd)).trim() || cwd;
    location = { kind: 'current', dir: repoDir };
    remote = url;
  } else {
    const root = resolve(deps.cacheRoot ?? defaultCacheRoot());
    ensureOwnDirectory(root);
    const ownerDir = join(root, pr.owner.toLowerCase());
    ensureOwnDirectory(ownerDir);
    repoDir = join(ownerDir, pr.repo.toLowerCase());
    let reused = true;
    try {
      lstatSync(repoDir);
    } catch {
      reused = false;
    }
    if (reused) {
      ensureOwnDirectory(repoDir);
      const origin = await runGit(['config', '--get', 'remote.origin.url'], { cwd: repoDir }).catch(() => '');
      if (origin.trim() !== url) throw new ConfigError(`--pr: the cached clone at ${repoDir} is not a clone of ${url}; delete it with: rm -rf ${repoDir}`);
    } else {
      // Clone next to the final place and rename, so an interrupted clone is never reused.
      const tmp = mkdtempSync(`${repoDir}.partial-`);
      try {
        log(`cloning ${pr.owner}/${pr.repo} without file contents (blobless partial clone)`);
        await runGit(['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--single-branch', '--no-tags', '--template=', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '--', url, tmp], { cwd: root, protocol });
        try {
          renameSync(tmp, repoDir);
        } catch {
          /* another run finished first: use its clone */
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    location = { kind: 'cache', dir: repoDir, reused };
    remote = 'origin';
  }

  const api = await apiP;
  const notes: string[] = [];
  const claimRules = builtinRules().filter((r) => r.needs.includes('prtext')).map((r) => r.id);
  let baseName: string;
  if (api.ok) baseName = await checkBranch(api.meta.baseRef, repoDir);
  else baseName = await checkBranch(await defaultBranch(repoDir, remote === 'origin' ? url : remote, protocol, location.kind === 'cache'), repoDir);

  const ns = `refs/testwitness/pr/${pr.number}`;
  const filter = location.kind === 'cache' ? ['--filter=blob:none'] : [];
  await runGit(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', ...filter, '--', remote, `+refs/pull/${pr.number}/head:${ns}/head`, `+refs/heads/${baseName}:${ns}/base`], { cwd: repoDir, protocol }).catch((err: unknown) => {
    const stderr = err instanceof GitError ? err.stderr : '';
    if (/couldn't find remote ref|could not find remote ref/i.test(stderr)) throw new ConfigError(`--pr: ${pr.url} or its base branch ${baseName} was not found on the remote`);
    throw err;
  });
  const head = (await runGit(['rev-parse', '--verify', `${ns}/head^{commit}`], { cwd: repoDir })).trim();
  const baseTip = (await runGit(['rev-parse', '--verify', `${ns}/base^{commit}`], { cwd: repoDir })).trim();

  // The read only view: an empty bare repository that borrows the objects. It has no remote, so nothing in the engine
  // can fetch through it.
  const objects = resolve(repoDir, (await runGit(['rev-parse', '--git-path', 'objects'], { cwd: repoDir })).trim());
  const view = mkdtempSync(join(tmpdir(), 'testwitness-pr-view-'));
  const dispose = (): void => rmSync(view, { recursive: true, force: true });
  try {
    await runGit(['init', '--quiet', '--bare', '--template=', view], { cwd: tmpdir() });
    mkdirSync(join(view, 'objects', 'info'), { recursive: true });
    writeFileSync(join(view, 'objects', 'info', 'alternates'), `${objects}\n`);
    const base = (await runGit(['merge-base', baseTip, head], { cwd: view }).catch(() => {
      throw new ConfigError(`--pr: the pull request head and ${baseName} share no history in the fetched objects`);
    })).trim();

    let missing = await missingObjects(view, await wantedBlobs(view, base, head));
    if (missing.length) {
      await runGit(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', ...filter, '--stdin', '--', remote], { cwd: repoDir, protocol, input: missing.join('\n') + '\n' });
      missing = await missingObjects(view, missing);
    }
    if (missing.length) notes.push(`${missing.length} file${missing.length === 1 ? '' : 's'} could not be fetched and read as absent.`);

    notes.unshift(`Trial run on ${pr.url}: diff only (--pr implies --diff-only), so no test results were read and the state reflects the diff${api.ok ? ' and the PR text' : ''} alone.`);
    if (!api.ok) notes.push(`GitHub API ${api.reason}: no PR title or body, so the claim rules (${claimRules.join(', ')}) were skipped; base is the default branch ${baseName}.`);
    return {
      pr,
      cwd: view,
      base,
      head,
      baseRef: baseName,
      ...(api.ok ? { title: api.meta.title, body: api.meta.body } : {}),
      notes,
      location,
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}
