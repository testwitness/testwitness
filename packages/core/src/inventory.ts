import type { InventoryPair, TestCase, TestInventory } from './types.js';

export type TestChange =
  | { kind: 'added'; head: TestCase }
  | { kind: 'deleted'; base: TestCase }
  | { kind: 'renamed'; base: TestCase; head: TestCase }
  | { kind: 'modified'; base: TestCase; head: TestCase }
  | { kind: 'unchanged'; base: TestCase; head: TestCase };

/**
 * Pair tests between the base and head inventories of one file.
 * Match by qualified name first; then pair leftover deleted and added tests
 * by body hash (a rename); the rest are deletions and additions.
 */
export function diffInventories(base: TestInventory | undefined, head: TestInventory | undefined): TestChange[] {
  const out: TestChange[] = [];
  const baseByName = new Map<string, TestCase[]>();
  for (const t of base?.tests ?? []) push(baseByName, t.qualifiedName, t);
  const headByName = new Map<string, TestCase[]>();
  for (const t of head?.tests ?? []) push(headByName, t.qualifiedName, t);

  const unmatchedBase: TestCase[] = [];
  const unmatchedHead: TestCase[] = [];

  for (const [name, bases] of baseByName) {
    const heads = headByName.get(name) ?? [];
    const n = Math.min(bases.length, heads.length);
    for (let i = 0; i < n; i++) {
      const b = bases[i]!;
      const h = heads[i]!;
      out.push(isSame(b, h) ? { kind: 'unchanged', base: b, head: h } : { kind: 'modified', base: b, head: h });
    }
    unmatchedBase.push(...bases.slice(n));
    unmatchedHead.push(...heads.slice(n));
    headByName.delete(name);
  }
  for (const heads of headByName.values()) unmatchedHead.push(...heads);

  // Rename detection by body hash.
  const headByHash = new Map<string, TestCase[]>();
  for (const t of unmatchedHead) push(headByHash, t.bodyHash, t);
  const stillHead = new Set(unmatchedHead);
  for (const b of unmatchedBase) {
    const candidates = headByHash.get(b.bodyHash);
    const h = candidates?.find((c) => stillHead.has(c));
    if (h && b.statementCount > 0) {
      stillHead.delete(h);
      out.push({ kind: 'renamed', base: b, head: h });
    } else {
      out.push({ kind: 'deleted', base: b });
    }
  }
  for (const h of stillHead) out.push({ kind: 'added', head: h });
  return out;
}

function isSame(a: TestCase, b: TestCase): boolean {
  return (
    a.bodyHash === b.bodyHash &&
    markersKey(a) === markersKey(b) &&
    a.parameterCount === b.parameterCount
  );
}

export function markersKey(t: TestCase): string {
  return t.markers
    .map((m) => `${m.kind}:${m.marker}:${m.constant ? '1' : '0'}`)
    .sort()
    .join('|');
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** Changes across all pairs, tagged with the pair they came from. */
export function allChanges(pairs: InventoryPair[]): Array<{ pair: InventoryPair; change: TestChange }> {
  const out: Array<{ pair: InventoryPair; change: TestChange }> = [];
  for (const pair of pairs) {
    for (const change of diffInventories(pair.base, pair.head)) out.push({ pair, change });
  }
  return out;
}

/** Does a test have an active (unconditional or constant true) skip style marker. */
export function isSkipped(t: TestCase): boolean {
  return t.markers.some((m) => (m.kind === 'skip' || m.kind === 'todo' || m.kind === 'fixme') && m.constant !== false);
}

export function isFocused(t: TestCase): boolean {
  return t.markers.some((m) => m.kind === 'focus');
}

export function isXfail(t: TestCase): boolean {
  return t.markers.some((m) => m.kind === 'xfail' && m.constant !== false);
}

/** A reason that references an issue or tracker lowers severity one step (spec R003). */
export function reasonReferencesIssue(reason: string | undefined): boolean {
  if (!reason) return false;
  return /(^|[\s(])#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b|https?:\/\/\S+\/(issues|pull|browse|-\/issues)\/\S+/.test(reason);
}

/** Lower a severity by one step, floor at low. */
export function lower(sev: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  return sev === 'high' ? 'medium' : 'low';
}
