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

/** Collect the body hashes of all tests across the head tree, lazily, for move detection. */
export async function headBodyHashIndex(ctx: RuleContext, excludePath?: string): Promise<Map<string, Array<{ path: string; test: TestCase }>>> {
  const index = new Map<string, Array<{ path: string; test: TestCase }>>();
  const files = await ctx.headTestFiles();
  for (const path of files) {
    if (path === excludePath) continue;
    const inv = await ctx.headInventoryFor(path);
    if (!inv) continue;
    for (const t of inv.tests) {
      if (t.statementCount === 0) continue;
      const arr = index.get(t.bodyHash);
      if (arr) arr.push({ path, test: t });
      else index.set(t.bodyHash, [{ path, test: t }]);
    }
  }
  return index;
}
