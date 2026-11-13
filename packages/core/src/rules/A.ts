import type { Assertion, CallSite, ChangedFile, Finding, Rule, Severity, TestCase } from '../types.js';
import { meaningOf, RANK, relatedSubjects } from '../assertion-meaning.js';
import type { Meaning } from '../assertion-meaning.js';
import { allChanges, isNonOracleCall } from '../inventory.js';
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

/**
 * Call statements in the head body that are new: not an assertion (by line), not a print, log or sleep call, and whose
 * callee name is not called anywhere in the base body (as a statement, in an assignment, or nested in an argument).
 * An assertion replaced one for one by a helper the front end cannot resolve (`result.did_create(path)` defined in
 * another module) shows up here; `lines = load()` turned into a bare `load()` does not.
 */
export function newCallStatements(base: TestCase, head: TestCase): CallSite[] {
  const baseNames = new Set((base.calls ?? []).map((c) => c.name));
  const assertionLines = new Set(head.assertions.map((a) => a.line));
  return (head.calls ?? []).filter((c) => c.statement && !assertionLines.has(c.line) && !baseNames.has(c.name) && !isNonOracleCall(c));
}

/** A001 Assertion removed. */
export const A001: Rule = {
  id: 'A001',
  name: 'Assertion removed',
  group: 'A',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A modified test lost one or more assertions and gained no replacement on the same subject.',
    falsePositives:
      'Consolidation of several assertions into one on the same subject (toEqual on an object, assertAll), and message asserts folded into a new match= on pytest.raises, are reported low as consolidated. An assertion removed from inside an exception expectation that stays (the block of pytest.raises or assertRaises, the callable of assertThrows or assertThatThrownBy, the function given to expect(fn).toThrow(TypeError)) is reported low with the label inside exception expectation: the code raises before such an assertion is evaluated, so the expectation is the oracle. This does not apply when the expected type is one an assertion failure satisfies (AssertionError, Exception, Error, Throwable, a bare toThrow()). A reduction matched by an increase in another test of the same class or describe block is reported low as assertions moved. Assertions moved into a helper are still counted when the helper is defined in the same file, or in a test support file of the checkout that contains an assertion (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test; a helper that calls another helper that asserts counts too). Such a replacement, for example inline asserts turned into result.did_create(path) with did_create defined in tests/lib, is a helper extraction and is silent. When the test gained at least as many new call statements as it lost assertions and none of them resolves to a helper with an assertion (a callee name not called anywhere in the base body, not a print, log or sleep call), the helper is outside the scanned locations, not on disk, or does not assert in a way the front end reads (a plain throw): the finding is low and is labelled replaced by call with the first new callee in the message. A001 ships at low (informational) by default until its measured precision improves: on the held out half of the corpus its precision on medium and high findings was 0.29, and 1 of its 4 findings in the 300 PR real world trial was true. A finding on a test that exercises a production file the PR changed (by name convention or import) is raised to medium. Raise it per repository with rules: { A001: medium } in .testwitness.yml.',
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
        const baseCustom = new Set(base.assertions.filter((a) => a.kind === 'custom').map(assertionKey));
        const newHelperCalls = head.assertions.filter((a) => a.kind === 'custom' && !baseCustom.has(assertionKey(a)));
        // Helper extraction: the assertions now live in a helper the front end resolved to assertions; the oracle is intact.
        if (newHelperCalls.length > 0) continue;
        // Message checks folded into the exception expectation: `with pytest.raises(E) as exc_info` plus asserts on the
        // message became `pytest.raises(E, match=...)`. The match is the message check.
        const gainedMatch = head.assertions.some((a) => /raises/i.test(a.callee) && /\bmatch\s*=/.test(a.text)) && !base.assertions.some((a) => /raises/i.test(a.callee) && /\bmatch\s*=/.test(a.text));
        if (allConsolidated || gainedMatch) {
          if (gainedMatch) {
            out.push(
              makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName}: ${lost} assertion${lost === 1 ? '' : 's'} folded into the match= of its pytest.raises`, {
                ...where,
                label: 'consolidated',
              }),
            );
            continue;
          }
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName}: ${lost} assertion${lost === 1 ? '' : 's'} consolidated into an assertion on the parent expression`, {
              ...where,
              label: 'consolidated',
            }),
          );
          continue;
        }
        // Inside an exception expectation: `with pytest.raises(E): assert obj.attr` became `_ = obj.attr`. The code
        // raises before the assertion is evaluated, so the expectation, which the head keeps, was the oracle all along.
        const exceptionCount = (list: Assertion[]): number => list.filter((a) => a.kind === 'exception' && !a.guarded).length;
        if (removed.every((r) => r.guarded) && exceptionCount(head.assertions) >= exceptionCount(base.assertions) && exceptionCount(head.assertions) > 0) {
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} assertion${lost === 1 ? '' : 's'} inside an exception expectation, which stays and is the oracle there`, {
              ...where,
              label: 'inside exception expectation',
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
        const sev: Severity = touches ? 'medium' : 'low';
        // Replaced by call: at least as many new call statements as lost assertions. The helper may assert (pip's
        // result.did_create) or may not; the engine cannot tell, so the finding drops one step and stays visible.
        const added = newCallStatements(base, head);
        if (added.length >= lost) {
          const first = added[0]!.name;
          out.push(
            makeFinding(ctx, 'A001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} assertion${lost === 1 ? '' : 's'} and gained ${added.length} new call${added.length === 1 ? '' : 's'}, first ${first}, which may assert in a helper the check cannot read`, {
              ...where,
              label: 'replaced by call',
            }),
          );
          continue;
        }
        out.push(
          makeFinding(ctx, 'A001', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} lost ${lost} of ${base.assertions.length} assertion${base.assertions.length === 1 ? '' : 's'}`, where),
        );
      }
    }
    return out;
  },
};

/** Negated assertion forms. assertNotNull and isNotNull are positive smoke checks, not negations. */
const NEGATED = /\.not\.|\.not$|\.to\.not\b|assertNot(Equals|Same|In|Contains|Thrown)|assert_not_|assertFalse|isNotEqualTo|isNotSameAs|doesNot|assertNotIn\b|\bnot_\w*called/;

interface Pairing {
  base: Assertion;
  head: Assertion;
  bm: Meaning;
  hm: Meaning;
  /** 1 same subject text, 2 same normalised subject, 3 by position among related leftovers. */
  stage: 1 | 2 | 3;
  /** The assertions sit inside a helper or a project matcher, so the engine cannot see everything they check. */
  nested: boolean;
}

/**
 * Both assertions sit on the shared lattice (positive by construction), or the front end put them in the same library
 * family with the same polarity as v0.1 read it from the callee.
 */
function comparable(b: Assertion, bm: Meaning, h: Assertion, hm: Meaning): boolean {
  if (bm.rank !== undefined && hm.rank !== undefined) return true;
  if (b.family === undefined || b.family !== h.family) return false;
  return NEGATED.test(b.callee) === NEGATED.test(h.callee);
}

/**
 * Pair base and head assertions of one test. Textually unchanged assertions pair first and are excluded, then
 * assertions on the same subject text, then on the same normalised subject (identity accessors and boolean wrappers
 * removed, local bindings resolved), then, only when the leftovers on the lattice are equal in number, by position
 * among leftovers whose subjects share an identifier word.
 */
export function pairAssertions(
  baseList: Assertion[],
  headList: Assertion[],
  baseLocals?: Record<string, string>,
  headLocals?: Record<string, string>,
  nested = false,
): Pairing[] {
  const bm = baseList.map((a) => meaningOf(a, baseLocals));
  const hm = headList.map((a) => meaningOf(a, headLocals));
  const usedHead = new Set<number>();
  const doneBase = new Set<number>();
  // Unchanged: the same text, subject and expected operand. Python records only the first line of a multi line
  // assert as its text, so the operands are part of the key.
  const unchangedKey = (a: Assertion): string => `${assertionKey(a)}|${norm(a.subject)}|${norm(a.expected)}`;
  baseList.forEach((b, i) => {
    const j = headList.findIndex((x, k) => !usedHead.has(k) && unchangedKey(x) === unchangedKey(b));
    if (j >= 0) {
      usedHead.add(j);
      doneBase.add(i);
    }
  });
  const pairs: Pairing[] = [];
  const take = (i: number, j: number, stage: 1 | 2 | 3): void => {
    usedHead.add(j);
    doneBase.add(i);
    pairs.push({ base: baseList[i]!, head: headList[j]!, bm: bm[i]!, hm: hm[j]!, stage, nested });
  };
  // Stage 1: same subject text. A candidate in the same library family is preferred, as before the lattice existed.
  baseList.forEach((b, i) => {
    if (doneBase.has(i)) return;
    const s = norm(b.subject);
    if (!s) return;
    const candidates = headList.map((h, j) => ({ h, j })).filter(({ h, j }) => !usedHead.has(j) && norm(h.subject) === s && comparable(b, bm[i]!, h, hm[j]!));
    const pick = candidates.find(({ h }) => b.family !== undefined && h.family === b.family) ?? candidates[0];
    if (pick) take(i, pick.j, 1);
  });
  // Stage 2: same normalised subject.
  baseList.forEach((b, i) => {
    if (doneBase.has(i)) return;
    const key = bm[i]!.subjectKey;
    if (!key) return;
    const j = headList.findIndex((h, k) => !usedHead.has(k) && hm[k]!.subjectKey === key && comparable(b, bm[i]!, h, hm[k]!));
    if (j >= 0) take(i, j, 2);
  });
  // Stage 3: by position, only when the leftovers on the lattice match one for one and each pair names a related subject.
  const restBase = baseList.map((_, i) => i).filter((i) => !doneBase.has(i) && bm[i]!.rank !== undefined);
  const restHead = headList.map((_, j) => j).filter((j) => !usedHead.has(j) && hm[j]!.rank !== undefined);
  if (restBase.length > 0 && restBase.length === restHead.length) {
    restBase.forEach((i, n) => {
      const j = restHead[n]!;
      if (relatedSubjects(bm[i]!.subjectKey || bm[i]!.subject, hm[j]!.subjectKey || hm[j]!.subject)) take(i, j, 3);
    });
  }
  return pairs;
}

interface Judgement {
  pair: Pairing;
  severity: Severity;
  /** The lattice decided, rather than the front end's library strength. */
  byLattice: boolean;
  drop: number;
}

/** Library strength rule kept from v0.1: two steps down, or landing on the smoke rung, is high. */
function strengthSeverity(bs: number, hs: number): Severity {
  return bs - hs >= 2 || hs <= 1 ? 'high' : 'medium';
}

/**
 * Did the pair get weaker, and how much it matters. Undefined when it held or got stronger. `productionChanged` says
 * the test exercises a production file this PR changed (name convention or import, as for A001).
 */
export function judgePair(p: Pairing, productionChanged = false): Judgement | undefined {
  const bs = p.base.strength;
  const hs = p.head.strength;
  const br = p.bm.rank;
  const hr = p.hm.rank;
  const sameLibrary = p.base.family !== undefined && p.base.family === p.head.family && bs !== undefined && hs !== undefined;
  const plain = p.stage === 1 && sameLibrary && !p.bm.viaWrapper && !p.hm.viaWrapper && !p.nested;
  if (plain) {
    if (hs! < bs!) return { pair: p, severity: strengthSeverity(bs!, hs!), byLattice: false, drop: bs! - hs! };
    if (hs === bs && br !== undefined && hr !== undefined && hr < br) return { pair: p, severity: 'medium', byLattice: true, drop: br - hr };
    return undefined;
  }
  if (br !== undefined && hr !== undefined) {
    if (hr >= br) return undefined;
    // Nothing about the value is checked any more, or the code under test changed in the same PR: high, unless the
    // pairing itself was a guess (by position) or the check sits in a helper or a project matcher.
    const severity: Severity = (hr <= RANK.exists || productionChanged) && p.stage <= 2 && !p.nested ? 'high' : 'medium';
    return { pair: p, severity, byLattice: true, drop: br - hr };
  }
  if (sameLibrary && hs! < bs! && p.stage <= 2) {
    const sev = strengthSeverity(bs!, hs!);
    return { pair: p, severity: p.stage === 1 && !p.nested ? sev : 'medium', byLattice: false, drop: bs! - hs! };
  }
  return undefined;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function describe(j: Judgement): string {
  const { base, head, bm, hm } = j.pair;
  if (!j.byLattice) {
    // Same callee on both sides (two plain asserts): name the statements, "assert became assert" says nothing.
    if (base.callee === head.callee) return `${clip(base.text)} became ${clip(head.text)}`;
    return `${base.callee} on ${base.subject ?? 'the subject'} became ${head.callee}`;
  }
  const onHead = hm.subject && compactText(hm.subject) !== compactText(bm.subject) ? ` on ${hm.subject}` : '';
  return `${bm.label} (${base.callee}) on ${bm.subject || 'the subject'} became ${hm.label} (${head.callee})${onHead}`;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 77)}...` : one;
}

function compactText(s: string): string {
  return s.replace(/\s+/g, '');
}

/** Judge every pair of one test or helper and keep the worst, so a test yields at most one A002 finding. */
function worst(judged: Judgement[]): Judgement | undefined {
  let best: Judgement | undefined;
  for (const j of judged) {
    if (!best || SEVERITY_ORDER[j.severity] > SEVERITY_ORDER[best.severity] || (SEVERITY_ORDER[j.severity] === SEVERITY_ORDER[best.severity] && j.drop > best.drop)) best = j;
  }
  return best;
}

/** A head assertion on a sub expression of the loosened subject that is at least as strong as the base assertion was. */
function strongerSubAssertion(head: TestCase, p: Pairing): boolean {
  const bs = p.base.strength;
  const subject = norm(p.base.subject);
  const key = p.bm.subjectKey;
  const br = p.bm.rank;
  return head.assertions.some((a) => {
    if (a === p.head) return false;
    if (a.strength !== undefined && bs !== undefined && a.strength >= bs && subject && norm(a.subject).startsWith(subject) && norm(a.subject) !== subject) return true;
    if (br === undefined || !key) return false;
    const m = meaningOf(a, head.locals);
    return m.rank !== undefined && m.rank >= br && m.subjectKey !== key && (m.subjectKey.startsWith(key + '.') || m.subjectKey.startsWith(key + '['));
  });
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
    summary:
      'An assertion on a subject was replaced by a weaker one. Every assertion is read onto one lattice shared by all languages: exact equality and snapshots at the top, then ordered or near equality (startsWith, an anchored regex, containsExactlyInAnyOrder, closeTo), then containment (toContain, contains, in, toMatchObject, hasItem, an unanchored regex), then a bound (greaterThan, >=, toBeLessThan), then a non empty check (greater than zero, not equal to zero, isNotEmpty), and at the bottom existence or truthiness (assertNotNull, toBeDefined, is not None, assertTrue on a plain value). Mock, exception and other library specific checks keep the strength their front end gives them. Base and head assertions are paired by subject: the same text first, then the same subject once identity accessors (length, size(), len(), trim(), get()), copies with a few fields overridden and boolean wrappers are removed, so assertTrue(body.contains(x)) is a containment check on body and all(d.get(k) == v for k, v in e.items()) is a subset check on d. A local name bound once to a projection of another reference is followed to that reference.',
    falsePositives:
      'Textually unchanged assertions pair first and are never compared. A negative check (not equal, not in) is never paired with a positive one, except that not equal to zero reads as a lower bound and not equal to null as an existence check. An assertion that got stronger, or moved between spellings of the same rank (is(equalTo(x)) to equalTo(x), assertEquals(true, c) to assertTrue(c)), is silent. Pairing by position happens only when the leftover assertions match one for one and each pair shares an identifier word in its subject, so a subject replaced by an unrelated one is not paired, and such a pairing is never more than medium. A move accompanied by a stronger assertion on a sub expression of the same subject is low and labelled narrowed. A loosening in a test that gained parameterised cases is low. A test yields at most one finding, the worst pair, naming the matcher before and after. Within one library family the v0.1 grading holds: two steps down, or landing on a smoke check, is high; otherwise a drop is medium, and it is high when the head checks nothing about the value (existence or truthiness) on the same subject, or when the test exercises a production file the PR changed (by name convention or import, as for A001). Checks inside a helper defined in the test file, or inside a project matcher (a Hamcrest matcher passed to a project method, an expectation object passed to a project toMatch), are compared the same way and capped at medium, labelled in helper or nested.',
    example: '-  assertEquals(new BigDecimal("12.50"), invoice.total());\n+  assertNotNull(invoice.total());',
  },
  run(ctx) {
    const out: Finding[] = [];
    const emit = (file: ChangedFile, subject: string, j: Judgement, count: number, extra: { label?: string; parameterCount?: [number | undefined, number | undefined]; head?: TestCase }): void => {
      const p = j.pair;
      let sev = j.severity;
      let label = extra.label;
      if (extra.head && strongerSubAssertion(extra.head, p)) {
        sev = 'low';
        label = 'narrowed';
      } else if (extra.parameterCount && (extra.parameterCount[1] ?? 1) > (extra.parameterCount[0] ?? 1)) {
        sev = 'low';
        label = 'parameterised';
      }
      const more = count > 1 ? `; ${count - 1} more assertion${count === 2 ? ' was' : 's were'} loosened` : '';
      out.push(
        makeFinding(ctx, 'A002', sev, file, subject, `${extra.label === 'in helper' ? 'Helper' : 'Test'} ${subject}: ${describe(j)}${more}`, {
          line: p.head.line,
          before: p.base.text,
          after: p.head.text,
          ...(label ? { label } : {}),
          snippet: `${assertionKey(p.base)}->${assertionKey(p.head)}`,
        }),
      );
    };
    const stems = changedProductionStems(ctx);
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      const exercised = exercisesChangedProduction(pair.head, pair.file.path, ctx);
      const judge = (p: Pairing): Judgement | undefined => judgePair(p, exercised || mentionsChangedProduction(p.base.text, stems));
      const judged = pairAssertions(base.assertions, head.assertions, base.locals, head.locals)
        .map(judge)
        .filter((j): j is Judgement => j !== undefined);
      const nested = pairAssertions(base.embedded ?? [], head.embedded ?? [], base.locals, head.locals, true)
        .map(judge)
        .filter((j): j is Judgement => j !== undefined);
      const top = worst(judged);
      if (top) {
        emit(pair.file, head.qualifiedName, top, judged.length + nested.length, { parameterCount: [base.parameterCount, head.parameterCount], head });
        continue;
      }
      const inner = worst(nested);
      if (inner) emit(pair.file, head.qualifiedName, inner, nested.length, { label: 'nested', parameterCount: [base.parameterCount, head.parameterCount] });
    }
    // Assertion helpers defined in the test file: a loosening there weakens every test that calls the helper.
    for (const pair of ctx.pairs) {
      const bh = pair.base?.helperAssertions;
      const hh = pair.head?.helperAssertions;
      if (!bh || !hh) continue;
      for (const name of Object.keys(hh).sort()) {
        const b = bh[name];
        const h = hh[name];
        if (!b || !h) continue;
        if (b.map(assertionKey).join('|') === h.map(assertionKey).join('|')) continue;
        const judged = pairAssertions(b, h, undefined, undefined, true)
          .map((p) => judgePair(p))
          .filter((j): j is Judgement => j !== undefined);
        const top = worst(judged);
        if (top) emit(pair.file, name, top, judged.length, { label: 'in helper' });
      }
    }
    return out;
  },
};

const LITERAL = /^(true|false|True|False|null|None|undefined|-?\d+(\.\d+)?[fFlLdD]?|"[^"]*"|'[^']*'|`[^`]*`)$/;

function isTautology(a: Assertion): boolean {
  const s = norm(a.subject);
  const e = norm(a.expected);
  // Truthiness assertion on a literal true: assert True, assertTrue(true), expect(true).toBeTruthy()
  if (s && !e && /^(true|True|1)$/.test(s) && !/\.not\b|False|false/.test(a.callee)) return true;
  if (!s || !e) {
    // Fall back to text patterns.
    const t = norm(a.text);
    return /^(assertTrue|assert|self\.assertTrue|Assert\.assertTrue|assertThat)\(?(true|True)\)?$/.test(t) || /^expect\((true|1)\)\.(toBe|toEqual|toStrictEqual)\((true|1)\)$/.test(t) || /^assertEquals\(([^,]+),\1\)$/.test(t) || /^assert([^=]+)==\1$/.test(t);
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
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'An assertion whose two operands are the same literal or the same expression (assertTrue(true), expect(x).toEqual(x), assert x == x) was added or replaced a real assertion.',
    falsePositives: 'expect(a).toEqual(a) written on purpose to exercise a custom equality. Rare; acknowledge it with a reason. Ships at low (informational) by default until its measured precision improves: on the held out half of the corpus its precision on medium and high findings was 0.00, and it produced 0 true findings in 1 in the 300 PR real world trial. Raise it per repository with rules: { A009: medium } in .testwitness.yml.',
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
        out.push(
          makeFinding(ctx, 'A009', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} has a tautological assertion: ${a.text}`, {
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
