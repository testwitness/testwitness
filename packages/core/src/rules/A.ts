import type { Assertion, Finding, Rule, Severity, TestCase } from '../types.js';
import { allChanges } from '../inventory.js';
import { changedProductionStems, makeFinding, exercisesChangedProduction } from './util.js';

const RULE_SINCE = '0.1.0';

function norm(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, '').replace(/;$/, '');
}

function assertionKey(a: Assertion): string {
  return norm(a.text);
}

/** Does any changed production stem appear in the text. */
function mentionsChangedProduction(text: string, stems: Set<string>): boolean {
  if (stems.size === 0) return false;
  const lower = text.toLowerCase();
  for (const s of stems) if (s.length >= 3 && lower.includes(s)) return true;
  return false;
}

/** A001 Assertion removed. */
export const A001: Rule = {
  id: 'A001',
  name: 'Assertion removed',
  group: 'A',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A modified test lost one or more assertions and gained no replacement on the same subject.',
    falsePositives:
      'Consolidation of several assertions into one on the same subject (toEqual on an object, assertAll) is reported low as consolidated. A reduction matched by an increase in another test of the same class or describe block is reported low as assertions moved. Assertions moved into a helper in the same file are still counted.',
    example: '   expect(res.status).toBe(200);\n-  expect(res.body.total).toBe(1250);\n-  expect(ledger.entries).toHaveLength(2);',
  },
  run(ctx) {
    const out: Finding[] = [];
    const stems = changedProductionStems(ctx);
    for (const pair of ctx.pairs) {
      const changes = allChanges([pair]);
      // Net assertion gain per container, for the "moved" control.
      const gainByContainer = new Map<string, number>();
      for (const { change } of changes) {
        if (change.kind !== 'modified' && change.kind !== 'renamed' && change.kind !== 'added') continue;
        const head = change.head;
        const base = change.kind === 'added' ? undefined : change.base;
        const delta = head.assertions.length - (base?.assertions.length ?? 0);
        if (delta > 0) {
          const k = head.container.join('/');
          gainByContainer.set(k, (gainByContainer.get(k) ?? 0) + delta);
        }
      }
      for (const { change } of changes) {
        if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
        const { base, head } = change;
        if (head.assertions.length >= base.assertions.length) continue;
        if (head.statementCount === 0) continue; // R006
        const headKeys = new Set(head.assertions.map(assertionKey));
        const removed = base.assertions.filter((a) => !headKeys.has(assertionKey(a)));
        if (removed.length === 0) continue;
        // Exception expectation removal belongs to E003 (v0.2); still report here in v0.1.
        const headSubjects = head.assertions.map((a) => norm(a.subject)).filter(Boolean);
        const allConsolidated = removed.every((r) => {
          const s = norm(r.subject);
          if (!s) return false;
          // the removed subject is a sub expression of a surviving or new assertion subject, or vice versa
          return headSubjects.some((hs) => hs !== s && (s.startsWith(hs + '.') || s.startsWith(hs + '[') || hs.startsWith(s + '.') || hs.startsWith(s + '[')));
        });
        const lost = removed.length;
        const where = { line: removed[0]!.line, before: removed.map((r) => r.text).join('\n'), snippet: removed.map(assertionKey).sort().join('|') };
        if ((head.parameterCount ?? 1) > (base.parameterCount ?? 1)) {
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} assertion${lost === 1 ? '' : 's'} but now runs ${head.parameterCount} parameterised cases`, {
              ...where,
              label: 'parameterised',
            }),
          );
          continue;
        }
        if (allConsolidated) {
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName}: ${lost} assertion${lost === 1 ? '' : 's'} consolidated into an assertion on the parent expression`, {
              ...where,
              label: 'consolidated',
            }),
          );
          continue;
        }
        const container = head.container.join('/');
        const gain = gainByContainer.get(container) ?? 0;
        if (gain >= lost) {
          gainByContainer.set(container, gain - lost);
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} assertion${lost === 1 ? '' : 's'}; other tests in the same group gained as many`, {
              ...where,
              label: 'assertions moved',
            }),
          );
          continue;
        }
        const touches = removed.some((r) => mentionsChangedProduction(r.text, stems)) || exercisesChangedProduction(pair.head, pair.file.path, ctx);
        const sev: Severity = touches ? 'high' : 'medium';
        out.push(
          makeFinding(ctx, 'A001', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} of ${base.assertions.length} assertion${base.assertions.length === 1 ? '' : 's'}`, where),
        );
      }
    }
    return out;
  },
};

interface Pairing {
  base: Assertion;
  head: Assertion;
}

/** Pair base and head assertions on the same normalised subject within a test. Textually unchanged assertions are matched first and excluded, so only edited assertions are compared. */
function pairBySubject(base: TestCase, head: TestCase): Pairing[] {
  const used = new Set<Assertion>();
  const unchangedBase = new Set<Assertion>();
  for (const b of base.assertions) {
    const same = head.assertions.find((x) => !used.has(x) && assertionKey(x) === assertionKey(b));
    if (same) {
      used.add(same);
      unchangedBase.add(b);
    }
  }
  const pairs: Pairing[] = [];
  for (const b of base.assertions) {
    if (unchangedBase.has(b)) continue;
    const s = norm(b.subject);
    if (!s || !b.family) continue;
    const negated = /\.not\b|\bnot[A-Z_]|assert_not_|assertNot|assertFalse/.test(b.callee);
    const h = head.assertions.find(
      (x) => !used.has(x) && norm(x.subject) === s && x.family === b.family && /\.not\b|\bnot[A-Z_]|assert_not_|assertNot|assertFalse/.test(x.callee) === negated,
    );
    if (h) {
      used.add(h);
      pairs.push({ base: b, head: h });
    }
  }
  return pairs;
}

/** A002 Assertion loosened. */
export const A002: Rule = {
  id: 'A002',
  name: 'Assertion loosened',
  group: 'A',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'An assertion on a subject was replaced by a weaker one in the same family (equality to not null, exact collection to contains, called with arguments to called).',
    falsePositives:
      'One step moves such as toEqual to toMatchObject are medium and show both lines. A move accompanied by a stronger assertion on a sub expression of the same subject is reported low.',
    example: '-  assertEquals(new BigDecimal("12.50"), invoice.total());\n+  assertNotNull(invoice.total());',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      for (const p of pairBySubject(base, head)) {
        const bs = p.base.strength;
        const hs = p.head.strength;
        if (bs === undefined || hs === undefined || hs >= bs) continue;
        const drop = bs - hs;
        const subject = norm(p.base.subject);
        const strongerSub = head.assertions.some(
          (a) => a !== p.head && a.strength !== undefined && a.strength >= bs && norm(a.subject).startsWith(subject) && norm(a.subject) !== subject,
        );
        let sev: Severity = drop >= 2 || hs <= 1 ? 'high' : 'medium';
        let label: string | undefined;
        if (strongerSub) {
          sev = 'low';
          label = 'narrowed';
        } else if ((head.parameterCount ?? 1) > (base.parameterCount ?? 1)) {
          sev = 'low';
          label = 'parameterised';
        }
        out.push(
          makeFinding(ctx, 'A002', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName}: ${p.base.callee} on ${p.base.subject ?? 'the subject'} became ${p.head.callee}`, {
            line: p.head.line,
            before: p.base.text,
            after: p.head.text,
            ...(label ? { label } : {}),
            snippet: `${assertionKey(p.base)}->${assertionKey(p.head)}`,
          }),
        );
      }
    }
    return out;
  },
};

const LITERAL = /^(true|false|True|False|null|None|undefined|-?\d+(\.\d+)?[fFlLdD]?|"[^"]*"|'[^']*'|`[^`]*`)$/;

function isTautology(a: Assertion): boolean {
  const s = norm(a.subject);
  const e = norm(a.expected);
  if (!s || !e) {
    // Fall back to text patterns.
    const t = norm(a.text);
    return /^(assertTrue|assert|self\.assertTrue|Assert\.assertTrue|assertThat)\(?(true|True)\)?/.test(t) || /^expect\((true|1)\)\.(toBe|toEqual|toStrictEqual)\((true|1)\)$/.test(t) || /^assertEquals\(([^,]+),\1\)$/.test(t) || /^assert([^=]+)==\1$/.test(t);
  }
  if (s === e) return true;
  if (LITERAL.test(s) && LITERAL.test(e) && s === e) return true;
  return false;
}

/** A009 Tautological assertion. */
export const A009: Rule = {
  id: 'A009',
  name: 'Tautological assertion',
  group: 'A',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'An assertion whose two operands are the same literal or the same expression (assertTrue(true), expect(x).toEqual(x), assert x == x) was added or replaced a real assertion.',
    falsePositives: 'expect(a).toEqual(a) written on purpose to exercise a custom equality. Rare; acknowledge it with a reason.',
    example: '+  expect(response).toBeDefined();\n+  expect(true).toBe(true);',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      let head: TestCase | undefined;
      let baseKeys = new Set<string>();
      if (change.kind === 'added') head = change.head;
      else if (change.kind === 'modified' || change.kind === 'renamed') {
        head = change.head;
        baseKeys = new Set(change.base.assertions.map(assertionKey));
      }
      if (!head) continue;
      for (const a of head.assertions) {
        if (baseKeys.has(assertionKey(a))) continue;
        if (!isTautology(a)) continue;
        const only = head.assertions.length === 1 && change.kind === 'added';
        out.push(
          makeFinding(ctx, 'A009', only ? 'medium' : 'high', pair.file, head.qualifiedName, `Test ${head.qualifiedName} has a tautological assertion: ${a.text}`, {
            line: a.line,
            after: a.text,
            snippet: assertionKey(a),
          }),
        );
      }
    }
    return out;
  },
};

export function rulesA(): Rule[] {
  return [A001, A002, A009];
}
