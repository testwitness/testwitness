/**
 * Shared helpers for the launch study scripts. Same collection approach as
 * corpus/_tools: REST search for metadata (`gh api search/issues` and
 * `search/repositories`; GraphQL and the repos endpoints are blocked from this
 * environment) and commit only git mirrors (`--filter=tree:0`) for the diff.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPath } from '../packages/core/src/index.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIRRORS = process.env['STUDY_MIRRORS'] ?? '/tmp/study-repos';

/** Study output directory: study/ by default, or `--dir <path>` (used for the smoke test). */
export function studyDir(argv: string[] = process.argv): string {
  const i = argv.indexOf('--dir');
  const d = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]!) : join(REPO_ROOT, 'study');
  mkdirSync(d, { recursive: true });
  return d;
}

export function flag(name: string, fallback: number, argv: string[] = process.argv): number {
  const i = argv.indexOf(`--${name}`);
  if (i < 0 || argv[i + 1] === undefined) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n)) throw new Error(`--${name} needs a number`);
  return n;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const log = (s: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

export const AGENTS = ['claude-code', 'copilot', 'devin', 'cursor', 'codex'] as const;
export type Agent = (typeof AGENTS)[number];
export type Cohort = Agent | 'human';
export const LANGUAGES = ['typescript', 'python', 'java'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PERIOD = { from: '2026-07-01', to: '2026-10-31' };
export const MIN_STARS = 100;
export const MIN_LINES = 20;
export const MAX_LINES = 2000;

/** Search qualifiers per agent. One query per entry; results are unioned. */
export const AGENT_QUERIES: Record<Agent, string[]> = {
  'claude-code': ['"Generated with Claude Code" in:body', '"Co-Authored-By: Claude" in:body'],
  copilot: ['author:app/copilot-swe-agent'],
  devin: ['author:app/devin-ai-integration'],
  cursor: ['author:app/cursor'],
  codex: ['"chatgpt.com/codex" in:body'],
};

/** Qualifiers that keep known agent apps out of the human baseline query. */
export const HUMAN_EXCLUDE = '-author:app/copilot-swe-agent -author:app/devin-ai-integration -author:app/cursor -author:app/dependabot -author:app/renovate';

/** Markers that identify each agent in a search result (author login or body text). */
export function agentMarkers(login: string, body: string): Set<Agent> {
  const out = new Set<Agent>();
  if (/Generated with \[?Claude Code/i.test(body) || /Co-Authored-By:\s*Claude\b/i.test(body)) out.add('claude-code');
  if (login === 'Copilot' || login === 'copilot-swe-agent[bot]') out.add('copilot');
  if (login === 'devin-ai-integration[bot]') out.add('devin');
  if (login === 'cursor[bot]') out.add('cursor');
  if (/chatgpt\.com\/codex/i.test(body)) out.add('codex');
  return out;
}

/** Looser signals of any assistant involvement; a human baseline PR must show none of them. */
export function looksAssisted(login: string, body: string): boolean {
  if (agentMarkers(login, body).size > 0) return true;
  if (/\[bot\]$/.test(login)) return true;
  return /claude|copilot|cursor\.com|cursor agent|devin|codex|chatgpt|openai|gemini|windsurf|aider|generated (with|by) (ai|an ai|a model)|co-authored-by:[^\n]*(bot|ai|agent|anthropic|openai)/i.test(body);
}

// ---------- process helpers ----------

export function run(cmd: string, args: string[], cwd?: string, timeoutMs = 15 * 60_000): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function runBuf(cmd: string, args: string[], cwd?: string): Buffer {
  return execFileSync(cmd, args, { cwd, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function tryRun(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 15 * 60_000 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ---------- GitHub search (REST only) ----------

export interface SearchItem {
  html_url: string;
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  repository_url: string;
  user: { login: string; type: string };
  pull_request?: { merged_at: string | null };
}

export interface RepoMeta {
  full_name: string;
  stars: number;
  license: string | null;
  language: string | null;
  default_branch: string;
  missing?: boolean;
}

let searchCalls = 0;
export const searchCallCount = () => searchCalls;

/** Every search call goes through here: sequential, paced, retried on rate limits. */
export async function ghSearch<T>(endpoint: 'search/issues' | 'search/repositories', params: Record<string, string>, paceMs = 8000): Promise<{ total_count: number; items: T[] }> {
  const args = ['api', '-X', 'GET', endpoint];
  for (const [k, v] of Object.entries(params)) args.push('-f', `${k}=${v}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (searchCalls > 0) await sleep(paceMs);
    searchCalls++;
    const r = tryRun('gh', args);
    if (r.ok) return JSON.parse(r.out);
    const msg = (r.err || r.out).slice(0, 300);
    if (/rate limit|403|secondary|abuse|502|503|504|timeout|connection reset|connection refused|EOF|i\/o timeout|TLS handshake/i.test(msg) && attempt < 3) {
      const wait = 60_000 * (attempt + 1);
      log(`search throttled (${msg.replace(/\s+/g, ' ').slice(0, 120)}), waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`gh ${args.join(' ')} failed: ${msg}`);
  }
  throw new Error('unreachable');
}

export const repoOf = (item: SearchItem) => item.repository_url.replace('https://api.github.com/repos/', '');

/** Repository metadata, cached on disk. Looks up up to six unknown repositories per search call. */
export async function repoMeta(repos: string[]): Promise<Map<string, RepoMeta>> {
  const cacheFile = join(MIRRORS, 'study-repo-meta.json');
  mkdirSync(MIRRORS, { recursive: true });
  const cache: Record<string, RepoMeta> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const unknown = [...new Set(repos.map((r) => r.toLowerCase()))].filter((r) => !cache[r]);
  const batches: string[][] = [];
  for (const r of unknown) {
    const last = batches[batches.length - 1];
    if (last && last.length < 6 && [...last, r].map((x) => `repo:${x}`).join(' ').length < 228) last.push(r);
    else batches.push([r]);
  }
  for (const b of batches) {
    const res = await ghSearch<{ full_name: string; stargazers_count: number; license: { spdx_id: string } | null; language: string | null; default_branch: string }>('search/repositories', {
      // fork:true, or search silently leaves forks out and they would look like missing repositories.
      q: `${b.map((x) => `repo:${x}`).join(' ')} fork:true`,
      per_page: '10',
    });
    for (const it of res.items) {
      cache[it.full_name.toLowerCase()] = { full_name: it.full_name, stars: it.stargazers_count, license: it.license?.spdx_id ?? null, language: it.language, default_branch: it.default_branch };
    }
    for (const x of b) if (!cache[x]) cache[x] = { full_name: x, stars: 0, license: null, language: null, default_branch: '', missing: true };
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return new Map(repos.map((r) => [r, cache[r.toLowerCase()]!]));
}

export function studyLanguage(meta: RepoMeta): Language | undefined {
  const l = (meta.language ?? '').toLowerCase();
  return (LANGUAGES as readonly string[]).includes(l) ? (l as Language) : undefined;
}

// ---------- git mirrors (same approach as corpus/_tools/ingest.py and files.py) ----------

export function mirrorDir(repo: string): string {
  return join(MIRRORS, `${repo.replace('/', '-')}.git`);
}

/** Commit only mirror of the default branch plus refs/pull/<n>/head; blobs are fetched on demand. */
export function mirror(repo: string, num: number): string {
  const g = mirrorDir(repo);
  if (!existsSync(join(g, 'HEAD'))) {
    mkdirSync(g, { recursive: true });
    run('git', ['init', '-q', '--bare'], g);
    run('git', ['remote', 'add', 'origin', `https://github.com/${repo}`], g);
    run('git', ['fetch', '-q', '--filter=tree:0', 'origin', 'HEAD:refs/heads/_default'], g);
  }
  if (!tryRun('git', ['rev-parse', '-q', '--verify', `refs/pull/${num}/head`], g).ok) {
    run('git', ['fetch', '-q', '--filter=tree:0', 'origin', `refs/pull/${num}/head:refs/pull/${num}/head`], g);
  }
  return g;
}

export function ensureCommit(g: string, sha: string): void {
  if (!tryRun('git', ['cat-file', '-e', `${sha}^{commit}`], g).ok) run('git', ['fetch', '-q', '--filter=tree:0', 'origin', sha], g);
}

/** Base the PR page compares against: merge base with the default branch, or with the merge commit's first parent. */
export function resolveBase(g: string, head: string): string | undefined {
  let base = tryRun('git', ['merge-base', '_default', head], g).out.trim();
  if (base === head) {
    base = '';
    for (const line of run('git', ['log', '--format=%H %P', '_default'], g).split('\n')) {
      const parts = line.split(' ');
      if (parts.slice(2).includes(head)) {
        base = run('git', ['merge-base', parts[1]!, head], g).trim();
        break;
      }
    }
  }
  return base || undefined;
}

export interface DiffStat {
  base: string;
  head: string;
  files: string[];
  additions: number;
  deletions: number;
  testFiles: number;
}

export function diffStat(g: string, num: number): DiffStat | string {
  const head = run('git', ['rev-parse', `refs/pull/${num}/head`], g).trim();
  const base = resolveBase(g, head);
  if (!base) return 'no merge base with the default branch';
  let additions = 0;
  let deletions = 0;
  const files: string[] = [];
  for (const line of run('git', ['diff', '--numstat', '--find-renames', base, head], g).split('\n')) {
    if (!line) continue;
    const [a, d, f] = line.split('\t', 3) as [string, string, string];
    // Renames print as "old => new" or "dir/{old => new}"; keep the new path.
    const path = f.includes(' => ') ? f.replace(/\{[^}]*? => ([^}]*)\}/, '$1').replace(/^.* => /, '').replace('//', '/') : f;
    files.push(path);
    if (a !== '-') {
      additions += Number(a);
      deletions += Number(d);
    }
  }
  const testFiles = files.filter(isTestPath).length;
  return { base, head, files, additions, deletions, testFiles };
}

/** Test file per the engine's own classifier (packages/core/src/diff/classify.ts), path only. */
export function isTestPath(path: string): boolean {
  return classifyPath(path, undefined).kind === 'test';
}

// ---------- misc ----------

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export function appendJsonl(file: string, rec: unknown): void {
  appendFileSync(file, JSON.stringify(rec) + '\n');
}

export const slugOf = (repo: string, num: number) => `${repo.replace('/', '-').toLowerCase()}-${num}`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Same sanitising as corpus/_tools/ingest.py --body: no comments, no mentions, no sign off lines. */
export function sanitiseBody(body: string | null): string {
  let b = body ?? '';
  b = b.replace(/<!--[\s\S]*?-->/g, '');
  b = b.replace(/@[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?/g, '[mention]');
  b = b.replace(/^\s*(co-authored-by|signed-off-by|author|reviewed-by):.*$/gim, '');
  return b.trim() + '\n';
}

/** Deterministic PRNG (mulberry32) so the sample and the label sheet can be redrawn. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface SampleRow {
  url: string;
  repo: string;
  number: number;
  agent: Cohort;
  language: Language;
  stars: number;
  license: string | null;
  created_at: string;
  merged_at: string | null;
  changed_lines: number;
  additions: number;
  deletions: number;
  files_changed: number;
  test_files: number;
  base_sha: string;
  head_sha: string;
  title: string;
  /** Sanitised PR body, kept locally for V004. Never published. */
  body: string;
}

export interface Rejected {
  url: string;
  agent: Cohort;
  language?: string;
  reason: string;
}
