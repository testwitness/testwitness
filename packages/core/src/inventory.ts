import type { CallSite, InventoryPair, TestCase, TestInventory } from './types.js';

/** Receivers and names of calls that print, log or wait. They never stand in for an assertion. */
const NON_ORACLE_ROOTS = new Set(['console', 'logging', 'logger', 'log', 'LOG', 'LOGGER', 'Logger', 'System', 'warnings', 'time', 'Thread']);
const NON_ORACLE_NAMES = new Set(['print', 'pprint', 'println', 'printf', 'printStackTrace', 'breakpoint', 'sleep', 'debugger']);

/** A call that prints, logs or waits (`print`, `console.*`, `logging.*`, `System.out.*`, `Thread.sleep`). */
export function isNonOracleCall(c: CallSite): boolean {
  const root = c.callee.split(/[.(]/, 1)[0] ?? '';
  return NON_ORACLE_ROOTS.has(root) || NON_ORACLE_NAMES.has(c.name);
}

export type TestChange =
  | { kind: 'added'; head: TestCase }
  | { kind: 'deleted'; base: TestCase }
  | { kind: 'renamed'; base: TestCase; head: TestCase }
  | { kind: 'modified'; base: TestCase; head: TestCase }
  | { kind: 'unchanged'; base: TestCase; head: TestCase };

/**
 * Pair tests between the base and head inventories of one file.
 * Match by qualified name first; then pair leftover deleted and added tests
 * by body hash (a rename), then by their own name when the class or group around them changed (a modification);
 * the rest are deletions and additions.
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
  // Same test in a renamed or other group: its class or describe block was renamed, or it moved between blocks of the
  // file, and its body was edited. Paired only when exactly one leftover test on each side carries the name, so two
  // tests that merely share a title are never confused.
  const leftBase = out.filter((c): c is { kind: 'deleted'; base: TestCase } => c.kind === 'deleted');
  if (leftBase.length && stillHead.size) {
    const headBySimple = new Map<string, TestCase[]>();
    for (const h of stillHead) push(headBySimple, h.name, h);
    const baseBySimple = new Map<string, TestCase[]>();
    for (const c of leftBase) push(baseBySimple, c.base.name, c.base);
    for (const c of leftBase) {
      const heads = headBySimple.get(c.base.name);
      if (heads?.length !== 1 || baseBySimple.get(c.base.name)!.length !== 1) continue;
      const h = heads[0]!;
      if (c.base.container.join('/') === h.container.join('/')) continue;
      stillHead.delete(h);
      out[out.indexOf(c)] = { kind: 'modified', base: c.base, head: h };
    }
  }
  for (const h of stillHead) out.push({ kind: 'added', head: h });
  return out;
}

function isSame(a: TestCase, b: TestCase): boolean {
  return (
    a.bodyHash === b.bodyHash &&
    markersKey(a) === markersKey(b) &&
    a.parameterCount === b.parameterCount &&
    assertionsKey(a) === assertionsKey(b)
  );
}

/** Assertions as seen by the front end, including helper calls that resolve to assertions; changes in a helper show up here even when the body did not change. */
export function assertionsKey(t: TestCase): string {
  return t.assertions.map((a) => `${a.kind}:${a.text.replace(/\s+/g, '')}`).join('|');
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
  return t.markers.some((m) => ((m.kind === 'skip' || m.kind === 'todo' || m.kind === 'fixme') && m.constant !== false) || (m.kind === 'conditional-skip' && m.constant === true));
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

/**
 * Capture then assert (E001): the catch body stores the caught error in a variable (`error = error_`, `caught = e`,
 * `err = e`) and a line after the try statement asserts on that variable. The failure is checked later, not swallowed.
 * `assertLine` tells an assertion line of the language.
 */
export function capturedThenAsserted(catchBody: string, param: string | undefined, after: string, assertLine: RegExp): boolean {
  if (!param || !/^[A-Za-z_$][\w$]*$/.test(param)) return false;
  const targets = new Set<string>();
  const assign = new RegExp(`(?:^|[\\s;{(])(?:this\\.|self\\.)?([A-Za-z_$][\\w$]*)\\s*=(?!=)\\s*${param.replace(/\$/g, '\\$')}\\b`, 'g');
  for (const m of catchBody.matchAll(assign)) if (m[1] !== param) targets.add(m[1]!);
  if (targets.size === 0) return false;
  return asserted(after, targets, assertLine);
}

/** Some line of `text` is an assertion that mentions one of `names` as a word. */
export function asserted(text: string, names: Set<string>, assertLine: RegExp): boolean {
  for (const ln of text.split(/\r?\n/)) {
    if (!assertLine.test(ln)) continue;
    for (const n of names) if (new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(ln)) return true;
  }
  return false;
}
