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
  const changedPaths = new Set(ctx.pairs.map((p) => p.file.path));
  for (const path of candidates) {
    const inv = await ctx.headInventoryFor(path);
    if (!inv) continue;
    for (const t of inv.tests) {
      if (t.statementCount > 0) {
        const arr = byHash.get(t.bodyHash);
        if (arr) arr.push({ path, test: t });
        else byHash.set(t.bodyHash, [{ path, test: t }]);
      }
      if (changedPaths.has(path)) {
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
