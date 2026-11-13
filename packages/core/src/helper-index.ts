/**
 * Helper index: assertion helpers defined in test support files of the checkout, so a call from a test to
 * `result.did_create(path)` (pip, tests/lib) or a base class method counts as an assertion without
 * `assertions.extra`. See docs/design.md, "Helpers in other files".
 *
 * Safety: files are only read and parsed with the front ends, never imported or executed. Symbolic links are not
 * followed. The scan is bounded by file count, total bytes and a per file size limit.
 */

import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { shortHash } from './hash.js';
import { isNonOracleCall } from './inventory.js';
import type { Assertion, CallSite, FrameworkProfile, HelperDefinition, HelperIndexSummary, LanguageFrontEnd, TestCase, TestInventory } from './types.js';

/** Directory names whose files are test support. */
export const SUPPORT_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'testing', 'test-utils', 'testutils', 'fixtures']);
/** Base names scanned first, so the cap keeps the files most likely to hold helpers. */
const SUPPORT_NAME = /helper|util|support|assert|matcher|conftest|__init__|base|abstract|common|lib/i;
/** Directories never entered. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', '.venv', 'venv', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.idea']);

export const HELPER_INDEX_LIMITS = {
  /** Support files considered at most. */
  maxFiles: 2000,
  /** Total bytes of support files considered at most. */
  maxBytes: 50 * 1024 * 1024,
  /** A single file larger than this is skipped: generated code, not a helper module. */
  maxFileBytes: 1024 * 1024,
  /** Directory entries visited at most while looking for support files. */
  maxEntries: 200_000,
};

/**
 * Calls that are framework, mock, timer, lifecycle or standard library calls: never a project assertion helper. They
 * do not trigger the index and are never resolved through it.
 */
const FRAMEWORK_CALLS = new Set([
  // mocks and stubs
  'when', 'thenReturn', 'thenThrow', 'thenAnswer', 'thenCallRealMethod', 'doReturn', 'doThrow', 'doNothing', 'doAnswer', 'given', 'willReturn', 'willThrow',
  'mock', 'spy', 'spyOn', 'fn', 'stub', 'returns', 'resolves', 'rejects', 'callsFake', 'restore', 'patch', 'mockReturnValue', 'mockReturnValueOnce',
  'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce', 'mockImplementation', 'mockImplementationOnce', 'mockClear', 'mockReset', 'mockRestore',
  'clearAllMocks', 'resetAllMocks', 'restoreAllMocks', 'resetModules', 'doMock', 'unmock', 'mocked', 'hoisted', 'stubGlobal', 'unstubAllGlobals', 'reset_mock', 'assert_called',
  // timers and lifecycle
  'useFakeTimers', 'useRealTimers', 'advanceTimersByTime', 'advanceTimersByTimeAsync', 'runAllTimers', 'runOnlyPendingTimers', 'setSystemTime', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'setUp', 'tearDown', 'setUpClass', 'tearDownClass', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'describe', 'it', 'test', 'skip', 'only',
  'fail', 'addCleanup', 'enterContext', 'start', 'stop',
  // collections, IO and other standard library calls
  'push', 'pop', 'shift', 'unshift', 'splice', 'add', 'addAll', 'put', 'putAll', 'set', 'get', 'append', 'extend', 'insert', 'remove', 'removeAll', 'delete', 'clear', 'update',
  'forEach', 'map', 'filter', 'reduce', 'sort', 'reverse', 'join', 'split', 'replace', 'close', 'open', 'flush', 'write', 'read', 'readline', 'send', 'emit', 'next', 'complete',
  'subscribe', 'unsubscribe', 'dispose', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'apply', 'call', 'bind', 'toString', 'valueOf', 'equals', 'hashCode',
  'require', 'import', 'super', 'this', 'exit', 'wait', 'notify', 'notifyAll', 'interrupt', 'run', 'execute', 'submit', 'invoke', 'await', 'sleep', 'gc',
  // browser and DOM actions
  'click', 'dblclick', 'fill', 'type', 'press', 'goto', 'hover', 'focus', 'blur', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'dispatchEvent', 'waitFor',
  'waitForSelector', 'waitForTimeout', 'waitForLoadState', 'waitForURL', 'reload', 'render', 'rerender', 'unmount', 'act', 'fireEvent', 'cleanup',
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Is the path (relative, forward slashes) a test support location. */
export function isSupportPath(rel: string): boolean {
  const parts = rel.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (base === 'conftest.py') return true;
  for (let i = 0; i < parts.length - 1; i++) if (SUPPORT_DIRS.has(parts[i]!)) return true;
  return false;
}

export interface SupportFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: SupportFile[];
  capped: boolean;
  warnings: string[];
}

/** Walk the working tree for support files with one of the extensions. Symbolic links are skipped, never followed. */
export function scanSupportFiles(cwd: string, extensions: string[], ignoreGlobs: string[], limits = HELPER_INDEX_LIMITS): ScanResult {
  const ignore = ignoreGlobs.length ? picomatch(ignoreGlobs, { dot: true }) : () => false;
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const found: SupportFile[] = [];
  const warnings: string[] = [];
  let entries = 0;
  let tooLarge = 0;
  let walkCapped = false;
  const stack: string[] = [''];
  while (stack.length) {
    const dir = stack.pop()!;
    let list;
    try {
      list = readdirSync(join(cwd, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    list.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (const e of list) {
      if (++entries > limits.maxEntries) {
        walkCapped = true;
        break;
      }
      if (e.isSymbolicLink()) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || ignore(`${rel}/x`)) continue;
        stack.push(rel);
        continue;
      }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf('.');
      if (dot < 0 || !exts.has(e.name.slice(dot).toLowerCase())) continue;
      if (!isSupportPath(rel) || ignore(rel)) continue;
      let st;
      try {
        st = lstatSync(join(cwd, rel));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > limits.maxFileBytes) {
        tooLarge++;
        continue;
      }
      found.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
    }
    if (walkCapped) break;
  }
  // Files whose name says helper, util, support, assert, matcher, conftest or base first, then by path.
  const rank = (f: SupportFile): number => (SUPPORT_NAME.test(f.path.split('/').pop() ?? '') ? 0 : 1);
  found.sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: SupportFile[] = [];
  let bytes = 0;
  let capped = walkCapped;
  for (const f of found) {
    if (files.length >= limits.maxFiles || bytes + f.size > limits.maxBytes) {
      capped = true;
      break;
    }
    files.push(f);
    bytes += f.size;
  }
  if (walkCapped) warnings.push(`The helper index stopped walking the checkout after ${limits.maxEntries.toLocaleString('en-US')} directory entries; helpers in support files it did not reach need assertions.extra.`);
  if (capped && !walkCapped) {
    warnings.push(
      `The helper index stopped at ${files.length.toLocaleString('en-US')} support files (${(bytes / 1048576).toFixed(1)} MB) of ${found.length.toLocaleString('en-US')}; the cap is ${limits.maxFiles.toLocaleString('en-US')} files and ${Math.round(limits.maxBytes / 1048576)} MB. Helpers in the files left out need assertions.extra.`,
    );
  }
  if (tooLarge > 0) warnings.push(`${tooLarge} support file${tooLarge === 1 ? ' was' : 's were'} larger than ${Math.round(limits.maxFileBytes / 1024)} KB and not indexed.`);
  return { files, capped, warnings };
}

interface FileDefs {
  definitions: HelperDefinition[];
  classBases: Record<string, string[]>;
}

interface CacheFile {
  version: 1;
  /** Hash of the scanned file list with sizes and mtimes; equal means every entry below is current. */
  listHash: string;
  files: Record<string, { size: number; mtimeMs: number } & FileDefs>;
}

export interface IndexedHelper {
  def: HelperDefinition;
  path: string;
}

export interface HelperIndexOptions {
  cwd: string;
  frontEndFor: (path: string) => LanguageFrontEnd | undefined;
  extensions: string[];
  ignore: string[];
  profile: FrameworkProfile;
  /** Directory for the cache file, or false for no cache. Default: os.tmpdir()/testwitness-helper-index. */
  cacheDir?: string | false;
  /** Part of the cache key, so a new tool version never reads an old cache. */
  version: string;
  limits?: typeof HELPER_INDEX_LIMITS;
  /** Write the cache only when parsing took at least this long. Default 200 ms. */
  cacheMinParseMs?: number;
  /** An inventory already built for this path from the same source (a changed test file at head), to skip a second parse. */
  known?: (path: string, source: string) => Promise<TestInventory | undefined>;
  log?: (msg: string) => void;
}

/** Writing a cache costs a file in the temp directory; below this much parse time it is not worth it. */
const CACHE_MIN_PARSE_MS = 200;

/**
 * Lazily built index. `ensure(names)` parses every support file that mentions one of the names (a definition always
 * mentions its own name), so lookups by those names are complete without parsing the whole scan list.
 */
export class HelperIndex {
  private scan: ScanResult | undefined;
  private readonly parsed = new Map<string, FileDefs>();
  private readonly byName = new Map<string, IndexedHelper[]>();
  private readonly bases = new Map<string, string[]>();
  private readonly contents = new Map<string, string>();
  private cache: CacheFile | undefined;
  private cachePath: string | undefined;
  private cacheDirty = false;
  private parseMs = 0;
  private readonly done = new Set<string>();
  parsedCount = 0;
  cachedCount = 0;
  /** Files whose inventory the engine had already built (changed test files at head). */
  reusedCount = 0;

  constructor(private readonly opts: HelperIndexOptions) {}

  private files(): ScanResult {
    this.scan ??= scanSupportFiles(this.opts.cwd, this.opts.extensions, this.opts.ignore, this.opts.limits);
    return this.scan;
  }

  private loadCache(): void {
    if (this.cache || this.opts.cacheDir === false) return;
    const scan = this.files();
    const listHash = shortHash(scan.files.map((f) => `${f.path}\0${f.size}\0${f.mtimeMs}`).join('\n'));
    try {
      const real = realpathSync(this.opts.cwd);
      const key = shortHash([real, this.opts.version, [...this.opts.profile.extraAssertions].sort().join(','), this.opts.extensions.join(',')].join('\n'));
      const dir = this.opts.cacheDir ?? defaultCacheDir();
      if (!ownDirectory(dir)) return;
      this.cachePath = join(dir, `${key}.json`);
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as CacheFile;
      if (parsed && parsed.version === 1 && typeof parsed.files === 'object') this.cache = { ...parsed, listHash };
    } catch {
      /* no cache yet, or unreadable: start empty */
    }
    if (this.cachePath) this.cache ??= { version: 1, listHash, files: {} };
  }

  private add(path: string, defs: FileDefs): void {
    this.parsed.set(path, defs);
    for (const d of defs.definitions) {
      const arr = this.byName.get(d.name);
      if (arr) arr.push({ def: d, path });
      else this.byName.set(d.name, [{ def: d, path }]);
    }
    for (const [cls, b] of Object.entries(defs.classBases)) {
      const arr = this.bases.get(cls) ?? [];
      for (const x of b) if (!arr.includes(x)) arr.push(x);
      this.bases.set(cls, arr);
    }
  }

  /** Make lookups of these names complete. */
  async ensure(names: Iterable<string>): Promise<void> {
    const wanted = [...new Set(names)].filter((n) => IDENTIFIER.test(n) && !this.done.has(n));
    if (wanted.length === 0) return;
    for (const n of wanted) this.done.add(n);
    const scan = this.files();
    this.loadCache();
    const escaped = wanted.map((n) => n.replace(/\$/g, '\\$'));
    const re = new RegExp(`(?<![\\w$])(?:${escaped.join('|')})(?![\\w$])`);
    for (const f of scan.files) {
      if (this.parsed.has(f.path)) continue;
      let src = this.contents.get(f.path);
      if (src === undefined) {
        try {
          src = await readFile(join(this.opts.cwd, f.path), 'utf8');
        } catch {
          src = '';
        }
        this.contents.set(f.path, src);
      }
      if (!re.test(src)) continue;
      this.contents.delete(f.path);
      const hit = this.cache?.files[f.path];
      if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
        this.cachedCount++;
        this.add(f.path, { definitions: hit.definitions, classBases: hit.classBases });
        continue;
      }
      const reuse = await this.opts.known?.(f.path, src);
      if (reuse) {
        this.reusedCount++;
        this.add(f.path, { definitions: (reuse.definitions ?? []).map(slim), classBases: reuse.classBases ?? {} });
        continue;
      }
      const fe = this.opts.frontEndFor(f.path);
      if (!fe) {
        this.add(f.path, { definitions: [], classBases: {} });
        continue;
      }
      const t0 = performance.now();
      let defs: FileDefs = { definitions: [], classBases: {} };
      try {
        const inv = await fe.inventory(f.path, src, this.opts.profile);
        defs = { definitions: (inv.definitions ?? []).map(slim), classBases: inv.classBases ?? {} };
      } catch (err) {
        this.opts.log?.(`helper index: could not parse ${f.path}: ${(err as Error).message}`);
      }
      this.parseMs += performance.now() - t0;
      this.parsedCount++;
      this.add(f.path, defs);
      if (this.cache) {
        this.cache.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, ...defs };
        this.cacheDirty = true;
      }
    }
  }

  lookup(name: string): IndexedHelper[] {
    return this.byName.get(name) ?? [];
  }

  /** Definitions of a name in one indexed file. */
  inFile(path: string, name: string): HelperDefinition[] {
    return (this.parsed.get(path)?.definitions ?? []).filter((d) => d.name === name);
  }

  basesOf(cls: string): string[] {
    return this.bases.get(cls) ?? [];
  }

  get capped(): boolean {
    return this.files().capped;
  }

  get warnings(): string[] {
    return this.files().warnings;
  }

  get fileCount(): number {
    return this.files().files.length;
  }

  /** Best effort: write the cache when parsing cost enough to be worth keeping. Never throws. */
  save(): void {
    if (!this.cache || !this.cachePath || !this.cacheDirty || this.parseMs < (this.opts.cacheMinParseMs ?? CACHE_MIN_PARSE_MS)) return;
    try {
      // Drop entries for files no longer in the scan list.
      const live = new Set(this.files().files.map((f) => f.path));
      for (const k of Object.keys(this.cache.files)) if (!live.has(k)) delete this.cache.files[k];
      const dir = join(this.cachePath, '..');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!ownDirectory(dir)) return;
      const tmp = `${this.cachePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.cache));
      renameSync(tmp, this.cachePath);
    } catch {
      /* caching is best effort */
    }
  }
}

/** Per user directory under the temp directory, so one user's cache is never read by another. */
export function defaultCacheDir(): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return join(tmpdir(), `testwitness-helper-index-${uid}`);
}

/** The directory is absent (it will be created) or a real directory owned by this user, not a link. */
function ownDirectory(dir: string): boolean {
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    return true;
  } catch {
    return true;
  }
}

/** Keep what resolution needs; drop source text the cache does not need twice. */
function slim(d: HelperDefinition): HelperDefinition {
  const out: HelperDefinition = {
    name: d.name,
    line: d.line,
    assertions: d.assertions.map((a) => {
      const x: Assertion = { callee: a.callee, text: a.text.length > 200 ? a.text.slice(0, 200) : a.text, line: a.line, kind: a.kind };
      if (a.strength !== undefined) x.strength = a.strength;
      if (a.family !== undefined) x.family = a.family;
      return x;
    }),
    calls: [...new Set(d.calls)],
  };
  if (d.className !== undefined) out.className = d.className;
  return out;
}

/** The receiver is the test object itself, or there is none: a base class method is in reach. */
function selfCall(c: CallSite): boolean {
  const dot = c.callee.lastIndexOf('.');
  if (dot < 0) return true;
  return /^(self|this|cls|super)$/.test(c.callee.slice(0, dot));
}

/**
 * Calls in a test that could be a project helper the file did not resolve: whole statement calls that are not on an
 * assertion line, not a print, log or sleep, not a framework or standard library call, and not an assertion helper
 * of the file itself.
 */
export function unresolvedCalls(t: TestCase, inv: TestInventory): CallSite[] {
  if (!t.calls?.length) return [];
  const lines = new Set(t.assertions.map((a) => a.line));
  return t.calls.filter((c) => c.statement && IDENTIFIER.test(c.name) && !lines.has(c.line) && !isNonOracleCall(c) && !FRAMEWORK_CALLS.has(c.name) && !inv.assertionHelpers.has(c.name));
}

/** Names the index must know about for these tests: their unresolved calls and, one level down, what local helpers call. */
export function namesToIndex(tests: Array<{ test: TestCase; inv: TestInventory }>): Set<string> {
  const out = new Set<string>();
  for (const { test, inv } of tests) {
    for (const c of unresolvedCalls(test, inv)) {
      out.add(c.name);
      for (const d of inv.definitions ?? []) if (d.name === c.name) for (const n of d.calls) out.add(n);
    }
  }
  return out;
}

/** Callee names of indexed definitions without assertions of their own, for the second level. */
export function secondLevelNames(index: HelperIndex, names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) for (const h of index.lookup(n)) if (h.def.assertions.length === 0) for (const c of h.def.calls) if (!FRAMEWORK_CALLS.has(c)) out.add(c);
  return out;
}

interface Verdict {
  helper: IndexedHelper;
  strength: number | undefined;
}

function strongest(as: Assertion[]): number | undefined {
  let s: number | undefined;
  for (const a of as) if (a.strength !== undefined && (s === undefined || a.strength > s)) s = a.strength;
  return s;
}

/**
 * Does the definition assert: directly, or through a call to another helper that asserts directly (the second level).
 * A callee is looked up in the definition's own file first, then in the index. Only one hop, so cycles cannot loop.
 */
function asserts(h: IndexedHelper, index: HelperIndex, localFile: { path: string; defs: HelperDefinition[] } | undefined): { strength: number | undefined } | undefined {
  if (h.def.assertions.length > 0) return { strength: strongest(h.def.assertions) };
  for (const name of h.def.calls) {
    if (FRAMEWORK_CALLS.has(name)) continue;
    const same = h.path === localFile?.path ? localFile.defs.filter((d) => d.name === name) : index.inFile(h.path, name);
    const pool = same.length ? same.map((def) => ({ def, path: h.path })) : index.lookup(name);
    const hit = pool.find((x) => x.def !== h.def && x.def.assertions.length > 0);
    if (hit) return { strength: strongest(hit.def.assertions) };
  }
  return undefined;
}

/** The test's class and its superclasses, as far as the file and the index know them. */
function classChain(t: TestCase, inv: TestInventory, index: HelperIndex): Set<string> {
  const out = new Set<string>();
  const start = t.container[t.container.length - 1];
  if (!start) return out;
  const queue = [start.split('$').pop() ?? start];
  while (queue.length && out.size < 16) {
    const c = queue.shift()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const b of [...(inv.classBases?.[c] ?? []), ...index.basesOf(c)]) queue.push(b);
  }
  return out;
}

function resolveCall(c: CallSite, t: TestCase, inv: TestInventory, index: HelperIndex): Verdict | undefined {
  const local = (inv.definitions ?? []).filter((d) => d.name === c.name);
  const localFile = { path: inv.path, defs: inv.definitions ?? [] };
  const self = selfCall(c);
  // A bare or self call to a name the file defines is that definition; the file already said it does not assert
  // directly, so only the second level can make it one.
  const pool: IndexedHelper[] = self && local.length ? local.map((def) => ({ def, path: inv.path })) : [...local.map((def) => ({ def, path: inv.path })), ...index.lookup(c.name)];
  if (pool.length === 0) return undefined;
  const judged = pool.map((h) => ({ h, v: asserts(h, index, localFile) }));
  const yes = judged.filter((j) => j.v);
  if (yes.length === 0) return undefined;
  if (yes.length < judged.length && self) {
    // The same name with and without assertions: the test's own class chain decides when it names one of them.
    const chain = classChain(t, inv, index);
    const mine = judged.filter((j) => j.h.def.className !== undefined && chain.has(j.h.def.className));
    if (mine.length) {
      const pick = mine.find((j) => j.v);
      return pick ? { helper: pick.h, strength: pick.v!.strength } : undefined;
    }
  }
  // Otherwise count it: a helper with an assertion somewhere under this name is more likely an assertion than not.
  const pick = yes[0]!;
  return { helper: pick.h, strength: pick.v!.strength };
}

/** Count calls to indexed helpers as custom assertions on the given tests. Returns what was resolved, for the report. */
export function resolveHelperCalls(tests: Array<{ test: TestCase; inv: TestInventory }>, index: HelperIndex): HelperIndexSummary['resolved'] {
  const out: HelperIndexSummary['resolved'] = [];
  const seen = new Set<TestCase>();
  for (const { test: t, inv } of tests) {
    if (seen.has(t)) continue;
    seen.add(t);
    const added: Assertion[] = [];
    for (const c of unresolvedCalls(t, inv)) {
      const v = resolveCall(c, t, inv, index);
      if (!v) continue;
      const { def, path } = v.helper;
      const a: Assertion = {
        callee: c.callee,
        text: (c.text ?? `${c.callee}()`).replace(/\s+/g, ' ').trim(),
        line: c.line,
        kind: 'custom',
        family: 'helper',
        resolvedVia: 'helper-index',
        helper: { name: def.name, path, line: def.line, ...(def.className !== undefined ? { className: def.className } : {}) },
      };
      if (v.strength !== undefined) a.strength = v.strength;
      added.push(a);
      out.push({ path: inv.path, test: t.qualifiedName, line: c.line, helper: def.className ? `${def.className}.${def.name}` : def.name, definedIn: path, definedLine: def.line });
    }
    if (added.length) t.assertions = [...t.assertions, ...added].sort((x, y) => x.line - y.line);
  }
  return out;
}
