import type { ChangedFile, Finding, Rule, RuleContext, Severity, TestCase, TestInventory } from '../types.js';

export type RuleFactory = () => Rule;

export function makeFinding(
  ctx: RuleContext,
  ruleId: string,
  severity: Severity,
  file: ChangedFile | string,
  subject: string,
  message: string,
  extra: Partial<Pick<Finding, 'before' | 'after' | 'label' | 'location'>> & { line?: number; endLine?: number; snippet?: string } = {},
): Finding {
  const path = typeof file === 'string' ? file : file.path;
  const location = extra.location ?? { path, ...(extra.line !== undefined ? { line: extra.line } : {}), ...(extra.endLine !== undefined ? { endLine: extra.endLine } : {}) };
  const f: Finding = {
    ruleId,
    severity,
    message,
    location,
    fingerprint: ctx.fingerprint(ruleId, path, subject, extra.snippet),
    subject,
  };
  if (extra.before !== undefined) f.before = extra.before;
  if (extra.after !== undefined) f.after = extra.after;
  if (extra.label !== undefined) f.label = extra.label;
  return f;
}

/** File stem without extension and without common test affixes. */
export function stem(path: string): string {
  const base = path.split('/').pop() ?? path;
  const noExt = base.replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');
  return noExt
    .replace(/^(test_|Test)/, '')
    .replace(/(_test|Test|Tests|IT|TestCase|Spec)$/, '');
}

/** Stems of production files changed by this PR, lower cased. */
export function changedProductionStems(ctx: RuleContext): Set<string> {
  const s = new Set<string>();
  for (const p of ctx.changedProductionFiles) s.add(stem(p).toLowerCase());
  return s;
}

/** Stems of production files deleted by this PR, lower cased. */
export function deletedProductionStems(ctx: RuleContext): Set<string> {
  const s = new Set<string>();
  for (const f of ctx.files) if (f.kind === 'production' && f.status === 'deleted') s.add(stem(f.path).toLowerCase());
  return s;
}

/**
 * The test file's subject was removed: its name convention stem or its imports
 * point at production files deleted in this PR, and at no modified ones.
 */
export function subjectRemoved(inv: TestInventory | undefined, path: string, ctx: RuleContext): boolean {
  const deleted = deletedProductionStems(ctx);
  if (deleted.size === 0) return false;
  const modified = new Set([...changedProductionStems(ctx)].filter((x) => !deleted.has(x)));
  const own = stem(path).toLowerCase();
  const refs = new Set<string>();
  if (own) refs.add(own);
  for (const imp of inv?.imports ?? []) for (const part of imp.split(/[./\\:]/).filter(Boolean)) refs.add(part.toLowerCase());
  let hitsDeleted = false;
  for (const r of refs) {
    if (modified.has(r)) return false;
    if (deleted.has(r)) hitsDeleted = true;
  }
  return hitsDeleted;
}

/**
 * Does the test file plausibly exercise a production file the PR changed?
 * Name convention match (billing.test.ts for billing.ts, FooServiceTest for FooService,
 * test_x.py for x.py) or an import that names a changed production stem.
 */
export function exercisesChangedProduction(inv: TestInventory | undefined, path: string, ctx: RuleContext): boolean {
  const stems = changedProductionStems(ctx);
  if (stems.size === 0) return false;
  const own = stem(path).toLowerCase();
  if (own && stems.has(own)) return true;
  for (const imp of inv?.imports ?? []) {
    const parts = imp.split(/[./\\:]/).filter(Boolean);
    for (const part of parts) if (stems.has(part.toLowerCase())) return true;
  }
  return false;
}

export function testLabel(t: TestCase): string {
  return t.qualifiedName;
}

/** Severity helpers. */
export const SEV: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEV[a] >= SEV[b] ? a : b;
}

export interface HeadIndex {
  byHash: Map<string, Array<{ path: string; test: TestCase }>>;
  /** Normalised assertion text to the paths of head tests (added or modified in this PR) that contain it. */
  assertionOwners: Map<string, Set<string>>;
  /** Short test name to the paths of changed files where a test with that name was added in this PR. */
  addedByName: Map<string, Set<string>>;
}

export function assertionKeyOf(text: string): string {
  return text.replace(/\s+/g, '').replace(/;$/, '');
}

/**
 * Index of head tests for move and refactor detection. Candidates are the head
 * side of every changed test file plus test files in the same directories, so a
 * monorepo with thousands of unrelated test files is never parsed in full.
 */
export async function headBodyHashIndex(ctx: RuleContext, excludePath?: string): Promise<Map<string, Array<{ path: string; test: TestCase }>>> {
  return (await headIndex(ctx, excludePath)).byHash;
}

const indexCache = new WeakMap<RuleContext, Promise<HeadIndex>>();

export function headIndex(ctx: RuleContext, excludePath?: string): Promise<HeadIndex> {
  // excludePath only affects lookups; the index itself is shared per context.
  let p = indexCache.get(ctx);
  if (!p) {
    p = buildHeadIndex(ctx);
    indexCache.set(ctx, p);
  }
  return p.then((idx) => (excludePath ? withoutPath(idx, excludePath) : idx));
}

function withoutPath(idx: HeadIndex, path: string): HeadIndex {
  const byHash = new Map<string, Array<{ path: string; test: TestCase }>>();
  for (const [k, arr] of idx.byHash) {
    const kept = arr.filter((e) => e.path !== path);
    if (kept.length) byHash.set(k, kept);
  }
  return { byHash, assertionOwners: idx.assertionOwners, addedByName: idx.addedByName };
}

async function buildHeadIndex(ctx: RuleContext): Promise<HeadIndex> {
  const byHash = new Map<string, Array<{ path: string; test: TestCase }>>();
  const assertionOwners = new Map<string, Set<string>>();
  const addedByName = new Map<string, Set<string>>();
  for (const p of ctx.pairs) {
    if (!p.head) continue;
    const baseNames = new Set((p.base?.tests ?? []).map((t) => t.name));
    for (const t of p.head.tests) {
      if (baseNames.has(t.name)) continue;
      const set = addedByName.get(t.name) ?? new Set<string>();
      set.add(p.file.path);
      addedByName.set(t.name, set);
    }
  }
  const changedDirs = new Set(ctx.pairs.map((p) => p.file.path.split('/').slice(0, -1).join('/')));
  const candidates = new Set<string>();
  for (const p of ctx.pairs) if (p.head) candidates.add(p.file.path);
  for (const f of await ctx.headTestFiles()) {
    const dir = f.split('/').slice(0, -1).join('/');
    if (changedDirs.has(dir)) candidates.add(f);
  }
  // Only tests that this PR added or changed can be the destination of a refactor.
  const changedTests = new Map<string, Set<string>>();
  for (const p of ctx.pairs) {
    if (!p.head) continue;
    const baseByName = new Map((p.base?.tests ?? []).map((t) => [t.qualifiedName, t]));
    const set = new Set<string>();
    for (const t of p.head.tests) {
      const b = baseByName.get(t.qualifiedName);
      if (!b || b.bodyHash !== t.bodyHash) set.add(t.qualifiedName);
    }
    changedTests.set(p.file.path, set);
  }
  for (const path of candidates) {
    const inv = await ctx.headInventoryFor(path);
    if (!inv) continue;
    const changedHere = changedTests.get(path);
    for (const t of inv.tests) {
      if (t.statementCount > 0) {
        const arr = byHash.get(t.bodyHash);
        if (arr) arr.push({ path, test: t });
        else byHash.set(t.bodyHash, [{ path, test: t }]);
      }
      if (changedHere?.has(t.qualifiedName)) {
        for (const a of t.assertions) {
          const k = assertionKeyOf(a.text);
          const set = assertionOwners.get(k) ?? new Set<string>();
          set.add(path);
          assertionOwners.set(k, set);
        }
      }
    }
  }
  return { byHash, assertionOwners, addedByName };
}

/**
 * Tests of a deleted (or shrunk) test file that reappear by name in a head test file with the same file name in another
 * directory: a class moved to another package with edits, which git sees as a deletion and an addition. Same file name
 * means the same class name in Java and the same module name in Python. Matching names in a file with another name are
 * never a move (two classes can both have a `test` method). Returns the destination path by qualified name.
 */
export async function movedByName(ctx: RuleContext, path: string, tests: TestCase[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tests.length === 0) return out;
  const name = path.split('/').pop() ?? path;
  const candidates = (await ctx.headTestFiles()).filter((f) => f !== path && (f.split('/').pop() ?? f) === name);
  for (const c of candidates) {
    const inv = await ctx.headInventoryFor(c);
    if (!inv) continue;
    const keys = new Set(inv.tests.map((t) => nameKey(t)));
    for (const t of tests) if (!out.has(t.qualifiedName) && keys.has(nameKey(t))) out.set(t.qualifiedName, c);
  }
  return out;
}

/** Innermost class or group plus test name: survives a package move, not a rename. */
function nameKey(t: TestCase): string {
  return `${t.container.at(-1) ?? ''}#${t.name}`;
}

/** Classes and top level functions a production source defines (Java: types and public or protected methods). */
export function definedSymbols(src: string, language: string | undefined): Set<string> {
  const out = new Set<string>();
  const res: RegExp[] =
    language === 'python'
      ? [/^(?:async\s+)?def\s+(\w+)/gm, /^class\s+(\w+)/gm]
      : language === 'java'
        ? [/\b(?:class|interface|enum|record)\s+(\w+)/g, /\b(?:public|protected)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+)*(?:<[^>]*>\s*)?(?!\s)[\w.<>[\],?\s]{1,300}?\s+(\w+)\s*\(/g]
        : [/^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|abstract\s+class)\s+(\w+)/gm, /^(?:async\s+)?function\*?\s+(\w+)/gm, /^class\s+(\w+)/gm];
  for (const re of res) for (const m of src.matchAll(re)) if (m[1] && m[1].length >= 4) out.add(m[1]);
  return out;
}

const removedCache = new WeakMap<RuleContext, Promise<Set<string>>>();

/**
 * Symbols this PR removed from production files that still exist: defined in the base of a modified production file,
 * absent from its head, and defined in the head of no other changed production file (not moved).
 */
export function removedProductionSymbols(ctx: RuleContext): Promise<Set<string>> {
  let p = removedCache.get(ctx);
  if (!p) {
    p = (async () => {
      const removed = new Set<string>();
      const stillDefined = new Set<string>();
      for (const f of ctx.files) {
        if (f.kind !== 'production' || f.status === 'deleted') continue;
        const head = definedSymbols((await ctx.readHead(f.path)) ?? '', f.language);
        for (const s of head) stillDefined.add(s);
        if (f.status !== 'modified' && f.status !== 'renamed') continue;
        const base = definedSymbols((await ctx.readBase(f.oldPath ?? f.path)) ?? '', f.language);
        for (const s of base) if (!head.has(s)) removed.add(s);
      }
      for (const s of stillDefined) removed.delete(s);
      return removed;
    })();
    removedCache.set(ctx, p);
  }
  return p;
}

/** Source lines of a base test, with the decorators or annotations directly above it. */
export async function baseTestText(ctx: RuleContext, path: string, t: TestCase): Promise<string> {
  const lines = ((await ctx.readBase(path)) ?? '').split(/\r?\n/);
  let start = t.startLine - 1;
  while (start > 0 && /^\s*@/.test(lines[start - 1] ?? '')) start--;
  return lines.slice(start, t.endLine).join('\n');
}

/** The production symbol a deleted test exercised that this PR removed from a file that still exists, if any. */
export async function removedSubjectOf(ctx: RuleContext, path: string, t: TestCase): Promise<string | undefined> {
  const removed = await removedProductionSymbols(ctx);
  if (removed.size === 0) return undefined;
  const text = `${t.container.join(' ')}\n${await baseTestText(ctx, path, t)}`;
  for (const s of removed) if (new RegExp(`\\b${s}\\b|\\b${s}(?=Tests?\\b)`).test(text)) return s;
  return undefined;
}

const VERSION_GATE = /\bsys\.version_info\b|\bPY_?3\d+\b|\bpython_version\b|\bprocess\.versions?\b|@(?:Enabled|Disabled)(?:On|For)Jre|\bJRE_\d+\b/;
const MIN_VERSION = /requires-python|python_requires|"node"\s*:|<maven\.compiler\.(?:source|release)>|sourceCompatibility|JavaVersion\.VERSION_/;

/** The PR raises the minimum supported language version (requires-python, engines.node, the Java release). */
export function minimumVersionRaised(ctx: RuleContext): boolean {
  const num = (l: string): number[] | undefined => /(\d+)(?:\.(\d+))?/.exec(l.replace(/^[^=:>]*[=:>]/, ''))?.slice(1).map((x) => Number(x ?? 0));
  for (const f of ctx.files) {
    if (f.kind === 'test' || f.kind === 'production') continue;
    for (const h of f.hunks) {
      const before = h.removed.find((l) => MIN_VERSION.test(l));
      const after = h.added.find((l) => MIN_VERSION.test(l));
      if (!before || !after) continue;
      const a = num(before);
      const b = num(after);
      if (a && b && (b[0]! > a[0]! || (b[0] === a[0] && b[1]! > a[1]!))) return true;
    }
  }
  return false;
}

/** A deleted test gated on a language version (skipif on sys.version_info, @EnabledOnJre) in a PR that raises the minimum version. */
export async function versionGated(ctx: RuleContext, path: string, t: TestCase): Promise<boolean> {
  if (!minimumVersionRaised(ctx)) return false;
  return VERSION_GATE.test(await baseTestText(ctx, path, t));
}

/**
 * Tokens of a test's source for the near duplicate check: whitespace, comments and statement semicolons dropped,
 * identifiers, numbers and punctuation kept as written, string literals reduced to their content (quote style ignored).
 * Tokens that name the test itself (its title string or function name) are dropped, so a copy under another name still
 * compares equal.
 */
export function testTokens(src: string, language: string | undefined, name: string): string[] {
  const out: string[] = [];
  for (const t of lexTokens(src, language === 'python')) {
    if (t.kind === 'comment') continue;
    if (t.kind === 'string') {
      const q = t.text.startsWith('"""') || t.text.startsWith("'''") ? 3 : 1;
      const content = t.text.slice(q, -q);
      if (content === name) continue;
      out.push(`"${content}`);
      continue;
    }
    if (t.text === ';' || t.text === name) continue;
    out.push(t.text);
  }
  return out;
}

const WORD = /[A-Za-z_$][\w$]*|\d[\w.]*/y;
const LINE_BREAK = new Set(['\n', '\r', String.fromCharCode(0x2028), String.fromCharCode(0x2029)]);

export interface LexToken {
  kind: 'string' | 'comment' | 'word' | 'char';
  text: string;
}

/**
 * Strings, comments, words and single characters of a source text, in order, whitespace dropped. The same tokens as
 * the two regular expressions this replaces (one for Python, one for the other languages: an alternation of string
 * forms, comment forms, a word, and any other character), but an opener without its closer is remembered. The regex
 * rescanned the rest of the line, or of the file, from every quote of an unterminated string, quadratic on a hostile
 * test file. A quote inside a string that did not close was read as an escaped character, so a string that starts at
 * it runs into the same end and is not tried again.
 */
export function lexTokens(src: string, python: boolean): LexToken[] {
  const out: LexToken[] = [];
  // For each quote character, the position up to which a string opened by it is known not to close.
  const dead: Record<string, number> = { '"': 0, "'": 0, '`': 0 };
  const noCloser = new Set<string>();
  /** End of a quoted string that opens at `pos`, or -1. A `multiline` string may hold line breaks. */
  const quoted = (pos: number, quote: string, multiline: boolean): number => {
    if (pos < dead[quote]!) return -1;
    let i = pos + 1;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (c === quote) return i + 1;
      if (c === '\\') {
        // A backslash and one character that `.` matches, so not a line break.
        const n = src[i + 1];
        if (n === undefined || LINE_BREAK.has(n)) break;
        i++;
      } else if (!multiline && c === '\n') break;
    }
    dead[quote] = i;
    return -1;
  };
  /** End of `open ... close` from `pos`, or -1; remembers when no closer is left. */
  const delimited = (pos: number, open: string, close: string): number => {
    if (noCloser.has(close)) return -1;
    const end = src.indexOf(close, pos + open.length);
    if (end < 0) {
      noCloser.add(close);
      return -1;
    }
    return end + close.length;
  };
  const lineEnd = (pos: number): number => {
    const end = src.indexOf('\n', pos);
    return end < 0 ? src.length : end;
  };
  let pos = 0;
  while (pos < src.length) {
    const c = src[pos]!;
    if (/\s/.test(c)) {
      pos++;
      continue;
    }
    let end = -1;
    let kind: LexToken['kind'] = 'string';
    if (python) {
      if (src.startsWith('"""', pos)) end = delimited(pos, '"""', '"""');
      else if (src.startsWith("'''", pos)) end = delimited(pos, "'''", "'''");
      if (end < 0 && (c === '"' || c === "'")) end = quoted(pos, c, false);
      if (end < 0 && c === '#') {
        end = lineEnd(pos);
        kind = 'comment';
      }
    } else if (c === '"' || c === "'") end = quoted(pos, c, false);
    else if (c === '`') end = quoted(pos, c, true);
    else if (c === '/' && src[pos + 1] === '/') {
      end = lineEnd(pos);
      kind = 'comment';
    } else if (c === '/' && src[pos + 1] === '*') {
      end = delimited(pos, '/*', '*/');
      kind = 'comment';
    }
    if (end < 0) {
      WORD.lastIndex = pos;
      const m = WORD.exec(src);
      end = m ? pos + m[0].length : pos + 1;
      kind = m ? 'word' : 'char';
    }
    out.push({ kind, text: src.slice(pos, end) });
    pos = end;
  }
  return out;
}

/**
 * A longest common subsequence of two token lists, string literals compared without letter case. Returns the pairs of
 * aligned positions in order.
 */
function align(a: string[], b: string[]): Array<[number, number]> {
  const w = b.length + 1;
  const dp = new Int32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * w + j] = foldLiteral(a[i]!) === foldLiteral(b[j]!) ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (foldLiteral(a[i]!) === foldLiteral(b[j]!)) out.push([i++, j++]);
    else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return out;
}

const foldLiteral = (t: string): string => (t.startsWith('"') ? t.toLowerCase() : t);

/** A token that starts a check: expect, assert, should, verify and their spellings, or a toBe style matcher. */
const CHECK_TOKEN = /^(expect\w*|assert\w*|should\w*|verify\w*|to[A-Z]\w*)$/;

/** Fewest tokens a deleted test needs before it can be called a near duplicate; shorter tests differ in too little. */
export const NEAR_DUPLICATE_MIN_TOKENS = 25;

/**
 * Is the deleted test a near duplicate of `kept`: every token of the deleted test appears, in order, in the kept test
 * (string literals compared without letter case, and at most one literal differing only in case), the kept test is at
 * most half as long again, and everything the kept test adds is an extra check: each run of added tokens contains a
 * check token (expect, assert, should, verify, toBe) or is only commas. The kept test then runs the same setup and
 * the same checks, plus perhaps a few more. A deleted test that differs in any identifier, number or literal value is
 * not a near duplicate, and neither is one whose copy adds input (another event, argument or field) without a check.
 */
export function isNearDuplicate(deleted: string[], kept: string[]): boolean {
  if (deleted.length < NEAR_DUPLICATE_MIN_TOKENS) return false;
  if (kept.length < deleted.length || kept.length > deleted.length * 1.5) return false;
  const pairs = align(deleted, kept);
  if (pairs.length !== deleted.length) return false;
  if (pairs.filter(([i, j]) => deleted[i] !== kept[j]).length > 1) return false;
  const matched = new Set(pairs.map(([, j]) => j));
  let run: string[] = [];
  const runIsCheck = (): boolean => run.length === 0 || run.some((t) => CHECK_TOKEN.test(t)) || run.every((t) => t === ',');
  for (let j = 0; j <= kept.length; j++) {
    if (j < kept.length && !matched.has(j)) {
      run.push(kept[j]!);
      continue;
    }
    if (!runIsCheck()) return false;
    run = [];
  }
  return true;
}

/** Source lines of a test, with the decorators or annotations directly above it. */
function testText(lines: string[], t: TestCase): string {
  let start = t.startLine - 1;
  while (start > 0 && /^\s*@/.test(lines[start - 1] ?? '')) start--;
  return lines.slice(start, t.endLine).join('\n');
}

/**
 * A test that stays in the head of the same file or of another changed test file and makes the deleted test redundant
 * (see isNearDuplicate). Returns its path and the test.
 */
export async function nearDuplicateOf(ctx: RuleContext, path: string, t: TestCase, language: string | undefined): Promise<{ path: string; test: TestCase } | undefined> {
  const deleted = testTokens(await baseTestText(ctx, path, t), language, t.name);
  if (deleted.length < NEAR_DUPLICATE_MIN_TOKENS) return undefined;
  const pairs = [...ctx.pairs].sort((a, b) => Number(b.file.path === path) - Number(a.file.path === path));
  for (const pair of pairs) {
    if (!pair.head || pair.file.kind !== 'test') continue;
    const lines = ((await ctx.readHead(pair.file.path)) ?? '').split(/\r?\n/);
    for (const h of pair.head.tests) {
      if (pair.file.path === path && h.qualifiedName === t.qualifiedName) continue;
      const kept = testTokens(testText(lines, h), pair.file.language, h.name);
      if (isNearDuplicate(deleted, kept)) return { path: pair.file.path, test: h };
    }
  }
  return undefined;
}
