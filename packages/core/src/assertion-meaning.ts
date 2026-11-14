/**
 * What an assertion checks, independent of the library that spells it.
 *
 * A002 compares a base assertion with the head assertion that replaced it. Before this module it paired assertions
 * only when the subject text was identical and the front end's library family matched, so `expect(x.trim()).toBe(y)`
 * becoming `expect(x).toContain(y)`, or `assertEquals(a, h)` becoming `assertTrue(h.contains(a))`, went unseen.
 *
 * Here every assertion is reduced to a meaning:
 *   subjectKey  the subject with identity accessors and boolean wrappers removed (`x.length`, `len(x)`, `x.trim()`,
 *               `x.get()`, `{ ...x, k: v }`, `[f.id for f in x]` all become `x`; `h.contains(a)` becomes `h`)
 *   rank        one number on a lattice shared by every language: exact equality, ordered or near equality,
 *               partial containment, bound, non empty, existence or truthiness
 *   negated     a negative check (not equal, not in) that is never compared with a positive one, except the count
 *               and null cases that read as a lower bound or an existence check (`assertNotEquals(0, n)`, `x != null`)
 *
 * Everything works on the source text the front ends already record, so the three languages share one table.
 */

import type { Assertion } from './types.js';

/** Lattice ranks. Higher is stronger. The gaps leave room for nested matchers (`has_item(contains_string(a))`). */
export const RANK = {
  exact: 60,
  ordered: 50,
  partial: 40,
  bound: 30,
  nonEmpty: 25,
  exists: 20,
} as const;

export interface Meaning {
  /** Normalised subject used for pairing. Empty when the assertion has no readable subject. */
  subjectKey: string;
  /** Subject text as the front end recorded it, whitespace squashed. */
  subject: string;
  /** Lattice rank, undefined when the matcher is not on the lattice (interaction, exception, custom helpers). */
  rank?: number;
  /** Plain words for the reason: `equality`, `containment`, `lower or upper bound`. */
  label: string;
  /** Negative check that is not a bound or an existence check. */
  negated: boolean;
  /** The meaning came from unwrapping a boolean wrapper (`assertTrue(x.contains(y))`, `expect(a.includes(b)).toBe(true)`). */
  viaWrapper: boolean;
}

/* ------------------------------------------------------------------------ */
/* Text scanning                                                             */
/* ------------------------------------------------------------------------ */

const OPEN = '([{';
const CLOSE = ')]}';

/** Characters after which a `/` starts a JavaScript regular expression literal rather than a division. */
const REGEX_PREFIX_CHARS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Walk the text, calling `visit(i, depth)` for every character outside string, template and regex literals.
 * Returns false when brackets do not balance. Linear in the length of the text.
 */
function scan(s: string, visit: (i: number, depth: number) => boolean | void): boolean {
  let depth = 0;
  let i = 0;
  /** Index of the last character that was not whitespace, -1 at the start. */
  let prev = -1;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === '`') {
      // Python triple quotes and ordinary quotes: skip to the matching quote, honouring escapes.
      const triple = s.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < s.length && !s.startsWith(q, j)) j += s[j] === '\\' ? 2 : 1;
      i = j + q.length;
      prev = i - 1;
      continue;
    }
    if (c === '/' && s[i + 1] !== '/' && s[i + 1] !== '*') {
      const p = prev >= 0 ? s[prev]! : '';
      const word = prev >= 0 ? /(?:^|[^\w$])(return|typeof)$/.test(s.slice(Math.max(0, prev - 7), prev + 1)) : false;
      if (prev < 0 || REGEX_PREFIX_CHARS.includes(p) || word) {
        let j = i + 1;
        let inClass = false;
        while (j < s.length) {
          const d = s[j]!;
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          j++;
        }
        if (j < s.length) {
          j++;
          while (j < s.length && /[a-z]/i.test(s[j]!)) j++;
          i = j;
          prev = i - 1;
          continue;
        }
      }
    }
    if (OPEN.includes(c)) {
      if (visit(i, depth) === true) return true;
      depth++;
    } else if (CLOSE.includes(c)) {
      depth--;
      if (depth < 0) return false;
      if (visit(i, depth) === true) return true;
    } else if (visit(i, depth) === true) return true;
    if (!/\s/.test(c)) prev = i;
    i++;
  }
  return depth === 0;
}

/** Index of the bracket that closes the one opening at `open`, or -1. */
function matchingClose(s: string, open: number): number {
  let found = -1;
  const target = s[open];
  if (!target || !OPEN.includes(target)) return -1;
  let startDepth = -1;
  scan(s, (i, depth) => {
    if (i === open) {
      startDepth = depth;
      return;
    }
    if (startDepth >= 0 && i > open && CLOSE.includes(s[i]!) && depth === startDepth) {
      found = i;
      return true;
    }
  });
  return found;
}

/** Split on a top level separator (comma by default). */
export function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = [];
  let last = 0;
  scan(s, (i, depth) => {
    if (depth === 0 && s[i] === sep) {
      out.push(s.slice(last, i).trim());
      last = i + 1;
    }
  });
  out.push(s.slice(last).trim());
  return out.filter((x) => x.length > 0);
}

/** Positions of top level occurrences of a token, respecting word boundaries for word operators. */
function topLevelIndexOf(s: string, token: string): number[] {
  const out: number[] = [];
  const word = /^\w/.test(token.trim());
  scan(s, (i, depth) => {
    if (depth !== 0 || !s.startsWith(token, i)) return;
    if (word) {
      const before = s[i - 1];
      const after = s[i + token.length];
      if (before !== undefined && /[\w.$]/.test(before) && !token.startsWith(' ')) return;
      if (after !== undefined && /[\w$]/.test(after) && !token.endsWith(' ')) return;
    }
    out.push(i);
  });
  return out;
}

/** Squash whitespace runs to one space and trim. */
export function squashSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Remove every whitespace character and optional chaining, the form used for comparing subjects. */
export function compact(s: string): string {
  return s.replace(/\s+/g, '').replace(/\?\.\[/g, '[').replace(/\?\.\(/g, '(').replace(/\?\./g, '.').replace(/;$/, '');
}

/** Text is entirely wrapped by one pair of brackets that match each other. */
function wrappedBy(s: string, open: string): boolean {
  return s.startsWith(open) && matchingClose(s, 0) === s.length - 1;
}

interface Call {
  /** Receiver left of the final `.name(...)`, undefined for a bare call. */
  receiver?: string;
  /** Callee name, last dotted segment. */
  name: string;
  /** Full dotted callee text (`re.search`, `hc.has_item`). */
  callee: string;
  args: string[];
  /** Raw text between the brackets, for generator arguments whose commas are not separators (`all(f(k) for k, v in d)`). */
  argText: string;
}

/** The expression is one call, `a.b.name(args)` or `name(args)`, and the call is the outermost operation. */
export function wholeCall(s: string): Call | undefined {
  const t = s.trim();
  if (!t.endsWith(')')) return undefined;
  // Find the opening bracket of the final argument list.
  let open = -1;
  scan(t, (i, depth) => {
    if (depth === 0 && t[i] === '(') open = i;
  });
  if (open <= 0 || matchingClose(t, open) !== t.length - 1) return undefined;
  const head = t.slice(0, open).trimEnd();
  const m = /(?:^|(\?\.|\.))\s*([A-Za-z_$][\w$]*)$/.exec(head);
  if (!m) return undefined;
  const name = m[2]!;
  const receiverText = m[1] ? head.slice(0, m.index).trimEnd() : undefined;
  if (receiverText !== undefined && receiverText.length === 0) return undefined;
  // A bare call must be a plain dotted name, not `a + b(x)`.
  if (receiverText !== undefined && !balancedPath(receiverText)) return undefined;
  const argText = t.slice(open + 1, -1);
  const call: Call = { name, callee: head.replace(/\s+/g, ''), args: splitTopLevel(argText), argText };
  if (receiverText !== undefined) call.receiver = receiverText;
  return call;
}

/** The receiver of a member call contains no top level operator, so `a + b.c(x)` is not a call on `a + b`. */
function balancedPath(s: string): boolean {
  let ok = true;
  scan(s, (i, depth) => {
    if (depth === 0 && /[\s+\-*/%<>=!&|?:,]/.test(s[i]!) && !(s[i] === '?' && s[i + 1] === '.') && !(s[i] === '-' && s[i + 1] === '>')) {
      ok = false;
      return true;
    }
  });
  return ok;
}

const LITERAL = /^(true|false|True|False|null|None|nil|undefined|NaN|-?\d[\d_]*(\.\d+)?[fFlLdDnN]?|0x[0-9a-fA-F]+[lL]?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`|[rbuf]?"[^"]*"|[rbuf]?'[^']*')$/;

export function isLiteral(s: string): boolean {
  return LITERAL.test(s.trim());
}

function isNullish(s: string): boolean {
  return /^(null|None|nil|undefined)$/.test(s.trim());
}

function isZero(s: string): boolean {
  return /^0+[lLdDfF]?$|^0\.0+$/.test(s.trim());
}

function isOne(s: string): boolean {
  return /^1[lLdDfF]?$/.test(s.trim());
}

function booleanLiteral(s: string | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === 'true' || t === 'True' || t === 'Boolean.TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'Boolean.FALSE') return false;
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Subject normalisation                                                     */
/* ------------------------------------------------------------------------ */

/** Trailing accessors that read the same object: length, size, a trimmed or case folded copy, Optional.get(). */
const IDENTITY_MEMBERS = new Set(['length', 'size']);
const IDENTITY_CALLS = new Set([
  'size', 'length', 'count', 'trim', 'strip', 'rstrip', 'lstrip', 'trimEnd', 'trimStart', 'toString', 'get', 'lower', 'upper',
  'toLowerCase', 'toUpperCase', 'casefold', 'replace', 'replaceAll', 'keys', 'values', 'items', 'toList', 'toArray', 'asList',
  'stream', 'map', 'getText', 'text', 'json', 'join', 'sorted', 'getMessage', 'decode',
]);
/** Calls with no arguments only: `x.get()` reads the Optional, `x.get(k)` reads one entry. */
const NO_ARG_ONLY = new Set(['get', 'count', 'size', 'length', 'keys', 'values', 'items', 'toList', 'toArray', 'stream', 'json', 'text', 'getText', 'getMessage', 'decode']);
const IDENTITY_FUNCTIONS = new Set(['len', 'str', 'repr', 'list', 'set', 'frozenset', 'tuple', 'sorted', 'dict', 'String.valueOf', 'Objects.toString', 'Array.from', 'JSON.stringify', 'String', 'Number', 'Arrays.asList', 'List.copyOf', 'Set.copyOf']);

/**
 * Reduce a subject to the object it reads. Idempotent: normaliseSubject(normaliseSubject(s)) === normaliseSubject(s).
 */
export function normaliseSubject(input: string): string {
  let s = squashSpace(input).replace(/;$/, '').trim();
  for (let guard = 0; guard < 24; guard++) {
    const before = s;
    // Optional chaining and non null assertions read the same object: `a?.b!.length` is `a.b.length`.
    s = s.replace(/\?\.\[/g, '[').replace(/\?\.\(/g, '(').replace(/\?\.(?=[A-Za-z_$])/g, '.').replace(/([\w$\])}])!+(?=[.[])/g, '$1');
    s = s.replace(/^await\s+/, '').replace(/^yield\s+/, '').trim();
    while (s.endsWith('!') && !s.endsWith('!=')) s = s.slice(0, -1).trimEnd();
    if (wrappedBy(s, '(')) {
      const inner = s.slice(1, -1).trim();
      // A one element tuple `(x,)` is not a parenthesised expression.
      if (inner && !inner.endsWith(',')) s = inner;
    }
    // { ...x, k: v }: the object under test is x with a few fields overridden.
    if (wrappedBy(s, '{')) {
      const parts = splitTopLevel(s.slice(1, -1));
      const first = parts[0];
      if (first && first.startsWith('...') && !parts.slice(1).some((p) => p.startsWith('...'))) s = first.slice(3).trim();
    }
    // [e for v in xs if c], (e for v in xs), {e for v in xs}: the iterable.
    if (wrappedBy(s, '[') || wrappedBy(s, '(') || wrappedBy(s, '{')) {
      const inner = s.slice(1, -1);
      const fors = topLevelIndexOf(inner, ' for ');
      if (fors.length === 1) {
        const rest = inner.slice(fors[0]! + 5);
        const ins = topLevelIndexOf(rest, ' in ');
        if (ins.length >= 1) {
          let iter = rest.slice(ins[0]! + 4);
          const ifs = topLevelIndexOf(iter, ' if ');
          if (ifs.length) iter = iter.slice(0, ifs[0]);
          s = iter.trim();
        }
      }
    }
    const call = wholeCall(s);
    if (call) {
      if (call.receiver !== undefined && IDENTITY_CALLS.has(call.name) && !(NO_ARG_ONLY.has(call.name) && call.args.length > 0)) {
        s = call.receiver.trim();
      } else if (call.receiver === undefined || IDENTITY_FUNCTIONS.has(call.callee)) {
        if (IDENTITY_FUNCTIONS.has(call.callee) && call.args.length >= 1) s = call.args[0]!;
      }
    } else {
      const member = /^(.*\S)(?:\?\.|\.)(length|size)$/.exec(s);
      if (member && IDENTITY_MEMBERS.has(member[2]!) && balancedPath(member[1]!)) s = member[1]!;
    }
    if (s === before) break;
  }
  return s;
}

/** A plain reference: names, member access and index access with no call and no operator. */
export function isPlainPath(key: string): boolean {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^[\]()]*\])*$/.test(key);
}

/** Subject key: normalised, compacted, and resolved through local bindings whose initialiser projects another plain reference. */
export function subjectKey(subject: string | undefined, locals?: Record<string, string>): string {
  if (!subject) return '';
  let key = compact(normaliseSubject(subject));
  const seen = new Set<string>([key]);
  for (let i = 0; i < 3 && locals; i++) {
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) break;
    const init = locals[key];
    if (init === undefined) break;
    const resolved = compact(normaliseSubject(init));
    if (!isPlainPath(resolved) || seen.has(resolved)) break;
    seen.add(resolved);
    key = resolved;
  }
  return key;
}

/* ------------------------------------------------------------------------ */
/* Matcher table                                                             */
/* ------------------------------------------------------------------------ */

type Shape =
  | 'exact' // equality, sameness, snapshot of the whole subject
  | 'size' // size equality: hasSize(n), toHaveLength(n), lengthOf(n)
  | 'empty' // equality to empty: isEmpty(), toHaveLength(0)
  | 'ordered' // prefix, suffix, full match, near equality, unordered exact set
  | 'partial' // containment, subset, property, unanchored regex
  | 'regex' // rank from the pattern: anchored both ends is ordered, otherwise partial
  | 'bound' // ordering comparison
  | 'nonEmpty' // greater than zero, not empty, not zero
  | 'exists' // not null, defined, instance of
  | 'truthy' // boolean wrapper: the subject is a predicate
  | 'falsy' // negated boolean wrapper
  | 'notEqual' // negative equality, a lower bound when the expected value is zero
  | 'negative' // other negative checks
  | 'in' // Python `needle in container`, subject is the container
  | 'matcher'; // Hamcrest style: the expected operand is a matcher expression

const SHAPES: Record<string, Shape> = {};
function shape(kind: Shape, names: string): void {
  for (const n of names.split(/\s+/).filter(Boolean)) SHAPES[n] = kind;
}

shape('exact', `assertEquals assertEqual assertSame assertIs assertArrayEquals assertIterableEquals assertEqualsDeep assertListEqual
  assertDictEqual assertTupleEqual assertSetEqual assertSequenceEqual assertMultiLineEqual assertLinesMatch isEqualTo isSameAs
  isEqualByComparingTo isEqualToComparingFieldByField isEqualToComparingFieldByFieldRecursively isSameInstanceAs hasToString
  toBe toEqual toStrictEqual equal equals eq eql eqls deepEqual strictEqual deepStrictEqual == === is containsExactly
  containsExactlyElementsOf containsExactlyElementsIn containsExactlyEntriesOf toMatchInlineSnapshot toMatchSnapshot
  toMatchFileSnapshot toBeNull toBeUndefined toBeNaN null undefined NaN isNull isUndefined isNaN assertNull assertIsNone is-none hasValue
  hasMessage toThrowErrorMatchingInlineSnapshot equalTo equal_to sameInstance same_instance theInstance samePropertyValuesAs
  contains_exactly isEqualToIgnoringNewLines`);
shape('size', 'hasSize toHaveLength lengthOf length hasLength has_length assertLen toHaveCount hasSameSizeAs');
shape('empty', 'isEmpty empty toBeEmpty is_empty assertEmpty');
shape('ordered', `startsWith endsWith startswith endswith starts_with ends_with toBeCloseTo closeTo close_to isCloseTo approximately
  assertAlmostEqual approx containsExactlyInAnyOrder containsExactlyInAnyOrderElementsOf containsOnly containsOnlyElementsOf
  containsInAnyOrder contains_inanyorder sameMembers sameDeepMembers sameOrderedMembers hasSameElementsAs assertCountEqual
  equalToIgnoringCase equal_to_ignoring_case isEqualToIgnoringCase isEqualToIgnoringWhitespace equalToIgnoringWhiteSpace
  equalToCompressingWhiteSpace isEqualToIgnoringGivenFields assertEqualsNoOrder hasMessageStartingWith hasMessageEndingWith
  isEqualToNormalizingWhitespace arrayContaining containsSequence`);
shape('partial', `contains include includes toContain toContainEqual toMatchObject toHaveProperty property containsKey containsKeys
  containsEntry containsValue containsAnyOf containsAll containsAtLeast containsSubsequence hasItem hasItems has_item has_items
  has_entry has_entries has_key has_property has_properties contains_string containsString hasEntry hasKey hasProperty
  hasFieldOrPropertyWithValue keys key includeMembers deepInclude nestedInclude hasAllKeys containsAllKeys members isSubsetOf
  assertDictContainsSubset hasMessageContaining anySatisfy subset every_item everyItem
  string_contains_in_order stringContainsInOrder hasAnyKeys include_members isIn is_in`);
shape('regex', 'toMatch match matches assertRegex assertRegexpMatches toMatchRegex matchesPattern matchesRegex matches_regexp');
shape('bound', `> >= < <= compare greaterThan greaterThanOrEqualTo lessThan lessThanOrEqualTo greater_than greater_than_or_equal_to
  less_than less_than_or_equal_to isGreaterThan isGreaterThanOrEqualTo isLessThan isLessThanOrEqualTo isBetween isStrictlyBetween
  isAtLeast isAtMost toBeGreaterThan toBeGreaterThanOrEqual toBeLessThan toBeLessThanOrEqual above gt least gte below lt most lte
  within assertGreater assertGreaterEqual assertLess assertLessEqual hasSizeGreaterThan hasSizeGreaterThanOrEqualTo
  hasSizeLessThan hasSizeLessThanOrEqualTo hasSizeBetween isAbove isBelow isNegative isNotNegative isNotPositive`);
shape('nonEmpty', 'isPositive isNotZero isNotEmpty isNotBlank not_empty is_not_empty assertNotEmpty');
shape('exists', `assertNotNull isNotNull notNullValue not_none not_null toBeDefined isDefined isNotUndefined exist exists is-not-none
  assertIsNotNone isPresent isInstanceOf isInstanceOfAny isExactlyInstanceOf instanceOf instance_of isA toBeInstanceOf instanceof
  a an typeOf toBeTypeOf assertIsInstance isinstance anything assertInstanceOf isObject isString isArray isNumber isBoolean
  isFunction toBeOK toBeAttached`);
shape('truthy', 'assertTrue isTrue toBeTruthy ok isOk true truthy assert assert_ Truthy');
shape('falsy', 'assertFalse isFalse toBeFalsy false isNotOk falsy not');
shape('notEqual', `assertNotEquals assertNotEqual isNotEqualTo notEqual notStrictEqual notDeepEqual notDeepStrictEqual != !== is-not
  assertNotSame isNotSameAs assertIsNot`);
shape('negative', `doesNotContain notInclude assertNotIn not-in not_in doesNotMatch assertNotRegex isNotIn doesNotContainKey
  doesNotHaveProperty notMatch`);
shape('in', 'in assertIn');
shape('matcher', 'assertThat assert_that');

/** Hamcrest matchers that pass their argument through (`is(equalTo(x))`, `matches_all([m])`). */
const MATCHER_WRAPPERS = new Set(['is', 'is_', 'describedAs', 'described_as', 'matches_all', 'only_contains', 'as_', 'anyOf', 'any_of']);
const MATCHER_CONJUNCTIONS = new Set(['allOf', 'all_of', 'both', 'and']);
/** Containers whose element matchers decide how strict they are. */
const ELEMENT_CONTAINERS = new Set(['hasItem', 'hasItems', 'has_item', 'has_items', 'everyItem', 'every_item', 'contains_inanyorder', 'containsInAnyOrder', 'contains', 'contains_exactly', 'hasEntry', 'has_entry']);

const LABEL: Record<number, string> = {
  [RANK.exact]: 'equality',
  [RANK.ordered]: 'ordered or near equality',
  [RANK.partial]: 'containment',
  [RANK.bound]: 'bound',
  [RANK.nonEmpty]: 'non empty check',
  [RANK.exists]: 'existence or truthiness check',
};

export function rankLabel(rank: number | undefined): string {
  if (rank === undefined) return 'check';
  return LABEL[Math.floor(rank / 5) * 5] ?? LABEL[Math.floor(rank / 10) * 10] ?? 'check';
}

/** Chai language chains and flags that never name the matcher. */
const CHAIN_WORDS = new Set(['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also', 'deep', 'nested', 'own', 'ordered', 'any', 'all', 'itself', 'not', 'resolves', 'rejects', 'soft', 'poll', 'should', 'expect', 'assert', 'assertThat', 'then']);

/** The matcher name: the front end's explicit matcher, else the last meaningful segment of the callee. */
export function matcherName(a: Assertion): string {
  if (a.matcher) return a.matcher;
  // QUnit assert.expect(n) and Jest expect.assertions(n) declare a count; they check nothing about a value.
  if (/(^|\.)(expect|assertions|hasAssertions)$/.test(a.callee) && a.callee !== 'expect') return 'count';
  const segs = a.callee.split('.').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (i === 0 || !CHAIN_WORDS.has(s)) return s;
  }
  return a.callee;
}

/** Negation carried by the chain rather than by the matcher name: `expect(x).not.toBe(y)`, `expect(x).to.not.equal(y)`. */
const CHAIN_NEGATED = /(^|\.)not(\.|$)|\.to\.not\b/;
/** Negation anywhere in the callee, for matchers this module does not know. */
const NEGATED_CALLEE = /(^|\.)not(\.|$)|\.to\.not\b|assertNot(Equals|Same|In|Contains|Thrown)|assert_not_|isNot(EqualTo|SameAs|In)\b|doesNot|assertFalse|\bnot_\w*called/;

/* ------------------------------------------------------------------------ */
/* Meaning                                                                   */
/* ------------------------------------------------------------------------ */

interface Read {
  subject: string;
  rank?: number;
  negated: boolean;
  viaWrapper: boolean;
}

/** Rank of a regular expression or pattern operand: anchored at both ends pins the whole value. */
function regexRank(pattern: string | undefined, fullMatch = false): number {
  if (fullMatch) return RANK.ordered;
  if (pattern === undefined) return RANK.partial;
  let p = pattern.trim();
  const js = /^\/(.*)\/[a-z]*$/s.exec(p);
  if (js) p = js[1]!;
  else {
    const str = /^[rbuf]*(["'`])(.*)\1$/s.exec(p) ?? /^[rbuf]*("""|''')(.*)\1$/s.exec(p);
    if (str) p = str[2]!;
    else {
      // re.compile(r"...") or Pattern.compile("...")
      const c = wholeCall(p);
      if (c && /compile$/.test(c.name) && c.args[0]) return regexRank(c.args[0]);
      return RANK.partial;
    }
  }
  const anchoredStart = p.startsWith('^') || p.startsWith('\\A');
  const anchoredEnd = (p.endsWith('$') && !p.endsWith('\\$')) || p.endsWith('\\Z') || p.endsWith('\\z');
  return anchoredStart && anchoredEnd ? RANK.ordered : RANK.partial;
}

/** Rank of a Hamcrest or PyHamcrest matcher expression. Literals are equality. */
export function matcherExpressionRank(expr: string): { rank?: number; negated: boolean } {
  const t = expr.trim();
  if (wrappedBy(t, '[') || wrappedBy(t, '(')) {
    const parts = splitTopLevel(t.slice(1, -1));
    if (parts.length === 1) return matcherExpressionRank(parts[0]!);
    const ranks = parts.map((p) => matcherExpressionRank(p)).filter((r) => r.rank !== undefined && !r.negated);
    if (ranks.length === parts.length) return { rank: Math.max(...ranks.map((r) => r.rank!)), negated: false };
    return { negated: false };
  }
  const call = wholeCall(t);
  if (!call) return isLiteral(t) || isPlainPath(compact(t)) ? { rank: RANK.exact, negated: false } : { negated: false };
  const name = call.name;
  if (name === 'not' || name === 'is_not' || name === 'not_') {
    return { negated: true };
  }
  if (MATCHER_WRAPPERS.has(name)) {
    if (call.args.length === 0) return { negated: false };
    if (name === 'anyOf' || name === 'any_of') {
      const r = call.args.map((a) => matcherExpressionRank(a));
      if (r.some((x) => x.rank === undefined || x.negated)) return { negated: false };
      return { rank: Math.min(...r.map((x) => x.rank!)), negated: false };
    }
    const target = name === 'describedAs' || name === 'described_as' ? call.args[call.args.length - 1]! : call.args[0]!;
    if (name === 'matches_all' || name === 'only_contains') return matcherExpressionRank(call.args.length === 1 ? target : `[${call.args.join(',')}]`);
    return matcherExpressionRank(target);
  }
  if (MATCHER_CONJUNCTIONS.has(name)) {
    const r = call.args.map((a) => matcherExpressionRank(a)).filter((x) => x.rank !== undefined && !x.negated);
    if (r.length === 0) return { negated: false };
    return { rank: Math.max(...r.map((x) => x.rank!)), negated: false };
  }
  const kind = SHAPES[name];
  let rank: number | undefined;
  switch (kind) {
    case 'exact':
    case 'size':
    case 'empty':
      rank = RANK.exact;
      break;
    case 'ordered':
      rank = RANK.ordered;
      break;
    case 'partial':
      rank = RANK.partial;
      break;
    case 'regex':
      rank = regexRank(call.args[0], name === 'matches' || name === 'fullmatch');
      break;
    case 'bound':
      rank = RANK.bound;
      break;
    case 'nonEmpty':
      rank = RANK.nonEmpty;
      break;
    case 'exists':
    case 'truthy':
      rank = RANK.exists;
      break;
    case 'notEqual':
    case 'negative':
    case 'falsy':
      return { negated: true };
    default:
      return { negated: false };
  }
  // Hamcrest `contains(a, b)` is the exact ordered list; AssertJ `contains` is containment. Here we are in a matcher expression.
  if (name === 'contains') rank = RANK.exact;
  if (ELEMENT_CONTAINERS.has(name) && call.args.length > 0 && rank < RANK.exact) {
    const inner = call.args.map((a) => matcherExpressionRank(a));
    if (inner.every((x) => x.rank !== undefined && !x.negated)) {
      // Element strictness as a fraction: has_items('a') is above has_item(contains_string('a')).
      rank = rank + Math.min(...inner.map((x) => x.rank!)) / 100;
    }
  }
  return { rank, negated: false };
}

const COMPARISONS = ['===', '!==', '==', '!=', '>=', '<=', ' not in ', ' is not ', ' in ', ' is ', '>', '<'];
const MIRROR: Record<string, string> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' };
const INVERT: Record<string, string> = { '==': '!=', '===': '!==', '!=': '==', '!==': '===', '>': '<=', '<': '>=', '>=': '<', '<=': '>', in: 'not in', 'not in': 'in', is: 'is not', 'is not': 'is' };

/** Find a top level comparison. `<` and `>` need spaces around them so generics never split. */
function topComparison(e: string): { left: string; op: string; right: string } | undefined {
  // Boolean combinations are opaque: `a && a[1]`, `x == 1 or y == 2`.
  if (topLevelIndexOf(e, '&&').length || topLevelIndexOf(e, '||').length || topLevelIndexOf(e, ' and ').length || topLevelIndexOf(e, ' or ').length) return undefined;
  if (topLevelIndexOf(e, '?').some((i) => e[i + 1] !== '.' && e[i + 1] !== '?')) return undefined;
  for (const op of COMPARISONS) {
    const at = topLevelIndexOf(e, op).filter((i) => {
      if (op === '>' || op === '<') return e[i - 1] === ' ' && e[i + 1] === ' ';
      if (op === '==' || op === '!=') return e[i + 2] !== '=' && e[i - 1] !== '=' && e[i - 1] !== '!';
      if (op === '>=' || op === '<=') return e[i - 1] !== '=' && e[i - 1] !== '<' && e[i - 1] !== '>' && e[i + 2] !== '=';
      return true;
    });
    if (at.length === 1) {
      const i = at[0]!;
      const left = e.slice(0, i).trim();
      const right = e.slice(i + op.length).trim();
      if (!left || !right) return undefined;
      if (op === '>=' && left.endsWith('=')) continue;
      return { left, op: op.trim(), right };
    }
    if (at.length > 1) return undefined;
  }
  return undefined;
}

function compare(left: string, op: string, right: string, negated: boolean): Read {
  let l = left;
  let r = right;
  let o = negated ? (INVERT[op] ?? op) : op;
  if (negated && !INVERT[op]) return { subject: left, negated: true, viaWrapper: true };
  if (o === 'in' || o === 'not in') {
    if (o === 'not in') return { subject: r, negated: true, viaWrapper: true };
    return { subject: r, rank: RANK.partial, negated: false, viaWrapper: true };
  }
  if (isLiteral(l) && !isLiteral(r)) {
    [l, r] = [r, l];
    o = MIRROR[o] ?? o;
  }
  switch (o) {
    case '==':
    case '===':
    case 'is': {
      const b = booleanLiteral(r);
      if (b !== undefined) return readBoolean(l, !b);
      return { subject: l, rank: RANK.exact, negated: false, viaWrapper: true };
    }
    case '!=':
    case '!==':
    case 'is not': {
      if (isNullish(r)) return { subject: l, rank: RANK.exists, negated: false, viaWrapper: true };
      if (isZero(r)) return { subject: l, rank: RANK.nonEmpty, negated: false, viaWrapper: true };
      const b = booleanLiteral(r);
      if (b !== undefined) return readBoolean(l, b);
      return { subject: l, negated: true, viaWrapper: true };
    }
    case '>':
      return { subject: l, rank: isZero(r) ? RANK.nonEmpty : RANK.bound, negated: false, viaWrapper: true };
    case '>=':
      return { subject: l, rank: isOne(r) ? RANK.nonEmpty : RANK.bound, negated: false, viaWrapper: true };
    case '<':
    case '<=':
      return { subject: l, rank: RANK.bound, negated: false, viaWrapper: true };
    default:
      return { subject: l, negated: false, viaWrapper: true };
  }
}

/** Predicate calls whose receiver is the object under test. */
const PREDICATE_CALLS: Record<string, number> = {
  contains: RANK.partial,
  includes: RANK.partial,
  has: RANK.partial,
  containsKey: RANK.partial,
  containsValue: RANK.partial,
  containsAll: RANK.partial,
  hasOwnProperty: RANK.partial,
  __contains__: RANK.partial,
  issubset: RANK.partial,
  issuperset: RANK.partial,
  some: RANK.partial,
  every: RANK.partial,
  startsWith: RANK.ordered,
  endsWith: RANK.ordered,
  startswith: RANK.ordered,
  endswith: RANK.ordered,
  equals: RANK.exact,
  contentEquals: RANK.exact,
  equalsIgnoreCase: RANK.ordered,
  isPresent: RANK.exists,
  isDefined: RANK.exists,
};

/** Read a boolean expression: the subject of a predicate, a comparison, or the expression itself as a truthiness check. */
export function readBoolean(expr: string, negatedIn: boolean): Read {
  let e = squashSpace(expr);
  let negated = negatedIn;
  for (let guard = 0; guard < 8; guard++) {
    const before = e;
    if (wrappedBy(e, '(') && splitTopLevel(e.slice(1, -1)).length === 1) e = e.slice(1, -1).trim();
    if (/^!!/.test(e)) e = e.slice(2).trim();
    else if (/^!(?!=)/.test(e)) {
      e = e.slice(1).trim();
      negated = !negated;
    } else if (/^not\s+/.test(e)) {
      e = e.replace(/^not\s+/, '');
      negated = !negated;
    }
    e = e.replace(/^await\s+/, '');
    const bool = wholeCall(e);
    if (bool && bool.receiver === undefined && (bool.callee === 'Boolean' || bool.callee === 'bool') && bool.args.length === 1) e = bool.args[0]!;
    if (e === before) break;
  }
  const cmp = topComparison(e);
  if (cmp) return compare(cmp.left, cmp.op, cmp.right, negated);
  if (topLevelIndexOf(e, '&&').length || topLevelIndexOf(e, '||').length || topLevelIndexOf(e, ' and ').length || topLevelIndexOf(e, ' or ').length) {
    return negated ? { subject: e, negated: true, viaWrapper: false } : { subject: e, rank: RANK.exists, negated: false, viaWrapper: false };
  }
  const call = wholeCall(e);
  if (call) {
    // all(x.get(k) == v for k, v in expected.items()): a per key subset of x. any(...) is containment.
    if (call.receiver === undefined && (call.name === 'all' || call.name === 'any') && call.argText.trim()) {
      const gen = call.argText.trim();
      const body = wrappedBy(gen, '[') || wrappedBy(gen, '(') ? gen.slice(1, -1) : gen;
      const fors = topLevelIndexOf(body, ' for ');
      if (fors.length === 1) {
        const element = body.slice(0, fors[0]).trim();
        const rest = body.slice(fors[0]! + 5);
        const ins = topLevelIndexOf(rest, ' in ');
        const vars = ins.length ? rest.slice(0, ins[0]).split(',').map((v) => v.trim()) : [];
        let iter = ins.length ? rest.slice(ins[0]! + 4) : '';
        const ifs = topLevelIndexOf(iter, ' if ');
        if (ifs.length) iter = iter.slice(0, ifs[0]);
        const inner = readBoolean(element, false);
        const keyed = /^(.*\S)(?:\.get\((\w+)\)|\[(\w+)\])$/.exec(compact(inner.subject));
        if (keyed && vars.includes((keyed[2] ?? keyed[3])!)) {
          return negated ? { subject: keyed[1]!, negated: true, viaWrapper: true } : { subject: keyed[1]!, rank: RANK.partial, negated: false, viaWrapper: true };
        }
        if (iter.trim()) return negated ? { subject: iter.trim(), negated: true, viaWrapper: true } : { subject: iter.trim(), rank: RANK.partial, negated: false, viaWrapper: true };
      }
    }
    if (call.receiver === undefined && call.callee === 'isinstance' && call.args[0]) {
      return negated ? { subject: call.args[0], negated: true, viaWrapper: true } : { subject: call.args[0], rank: RANK.exists, negated: false, viaWrapper: true };
    }
    // re.search(p, x), re.match(p, x), re.fullmatch(p, x)
    if (/^(re|regex)\.(search|match|fullmatch|findall)$/.test(call.callee) && call.args.length >= 2) {
      const rank = regexRank(call.args[0], call.name === 'fullmatch');
      return negated ? { subject: call.args[1]!, negated: true, viaWrapper: true } : { subject: call.args[1]!, rank, negated: false, viaWrapper: true };
    }
    if (call.receiver !== undefined) {
      // /p/.test(x), pattern.matcher(x).matches()
      if (call.name === 'test' && call.args.length === 1 && /^\/.*\/[a-z]*$/s.test(call.receiver.trim())) {
        const rank = regexRank(call.receiver);
        return negated ? { subject: call.args[0]!, negated: true, viaWrapper: true } : { subject: call.args[0]!, rank, negated: false, viaWrapper: true };
      }
      if (call.name === 'matches' && call.args.length === 1) {
        return negated ? { subject: call.receiver, negated: true, viaWrapper: true } : { subject: call.receiver, rank: RANK.ordered, negated: false, viaWrapper: true };
      }
      if (call.name === 'match' && call.args.length === 1) {
        const rank = regexRank(call.args[0]);
        return negated ? { subject: call.receiver, negated: true, viaWrapper: true } : { subject: call.receiver, rank, negated: false, viaWrapper: true };
      }
      if (call.name === 'isEmpty' && call.args.length === 0) {
        return { subject: call.receiver, rank: negated ? RANK.nonEmpty : RANK.exact, negated: false, viaWrapper: true };
      }
      const r = PREDICATE_CALLS[call.name];
      if (r !== undefined && call.args.length <= 2) {
        return negated ? { subject: call.receiver, negated: true, viaWrapper: true } : { subject: call.receiver, rank: r, negated: false, viaWrapper: true };
      }
    }
  }
  return negated ? { subject: e, negated: true, viaWrapper: false } : { subject: e, rank: RANK.exists, negated: false, viaWrapper: false };
}

/** Is this assertion a Hamcrest style `assertThat(actual, matcher)` whose expected operand is a matcher expression. */
function isMatcherStyle(a: Assertion, name: string): boolean {
  if (a.family === 'hamcrest') return true;
  return SHAPES[name] === 'matcher' && a.expected !== undefined;
}

/**
 * Read an assertion into a Meaning. Pure: the same assertion always reads the same way.
 * `locals` resolves the subject through single bindings in the test body.
 */
export function meaningOf(a: Assertion, locals?: Record<string, string>): Meaning {
  const read = readAssertion(a);
  const subject = squashSpace(read.subject);
  const m: Meaning = {
    subjectKey: subjectKey(read.subject, locals),
    subject,
    label: read.negated ? 'negative check' : rankLabel(read.rank),
    negated: read.negated,
    viaWrapper: read.viaWrapper,
  };
  if (read.rank !== undefined && !read.negated) m.rank = read.rank;
  return m;
}

function readAssertion(a: Assertion): Read {
  const name = matcherName(a).trim().replace(/\s+/g, '-');
  let subject = a.subject ?? '';
  let expected = a.expected;
  // assertEquals(cond, true) in JUnit puts the literal where the actual value goes: the non literal operand is the subject.
  if ((SHAPES[name] === 'exact' || SHAPES[name] === 'notEqual') && expected !== undefined && isLiteral(subject) && !isLiteral(expected)) {
    [subject, expected] = [expected, subject];
  }
  const calleeNegated = NEGATED_CALLEE.test(a.callee);
  const chainNegated = CHAIN_NEGATED.test(a.callee);
  if (a.kind === 'custom' || a.kind === 'interaction' || a.kind === 'exception') return { subject, negated: calleeNegated, viaWrapper: false };
  if (a.family !== undefined && /^(interaction|exception|web|count|control|mockito|mock\.calls|spring|restassured|awaitility|approvals)$/.test(a.family)) {
    return { subject, negated: calleeNegated, viaWrapper: false };
  }
  if (isMatcherStyle(a, name)) {
    const expr = a.expected ?? '';
    // assertThat(x.contains(y), is(true)): the matcher pins a boolean, so the subject is the predicate.
    const pinned = /^(?:(?:\w+\.)*(?:is|is_|equalTo|equal_to)\()?(true|True|false|False)\)?$/.exec(compact(expr));
    if (pinned) return readBoolean(subject, /^f/i.test(pinned[1]!));
    const r = matcherExpressionRank(expr);
    const read: Read = { subject, negated: r.negated, viaWrapper: false };
    if (r.rank !== undefined) read.rank = r.rank;
    return read;
  }
  const kind = SHAPES[name];
  if (kind === undefined) return { subject, negated: calleeNegated, viaWrapper: false };
  // `.not.toBe(0)`, `.not.toHaveLength(0)`, `not.toBeNull()`: negative forms that read as a lower bound or existence.
  if (chainNegated && kind !== 'notEqual' && kind !== 'negative') {
    if ((kind === 'exact' || kind === 'size') && expected !== undefined && isZero(expected)) return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
    if (kind === 'exact' && (expected === undefined ? /^(toBeNull|toBeUndefined|null|undefined|isNull)$/.test(name) : isNullish(expected))) {
      return { subject, rank: RANK.exists, negated: false, viaWrapper: false };
    }
    if (kind === 'empty') return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
    if (kind === 'truthy') return readBoolean(subject, true);
    if (kind === 'falsy') return readBoolean(subject, false);
    return { subject, negated: true, viaWrapper: false };
  }
  switch (kind) {
    case 'exact': {
      const b = booleanLiteral(expected);
      if (b !== undefined) return readBoolean(subject, !b);
      // expect(values.includes(x)).toBe(cond): a predicate compared with a boolean expression is still the predicate.
      if (expected !== undefined && !isLiteral(expected) && looksLikePredicate(subject)) return readBoolean(subject, false);
      return { subject, rank: RANK.exact, negated: false, viaWrapper: false };
    }
    case 'size':
      if (expected !== undefined && isZero(expected)) return { subject, rank: RANK.exact, negated: false, viaWrapper: false };
      return { subject, rank: RANK.exact, negated: false, viaWrapper: false };
    case 'empty':
      return { subject, rank: RANK.exact, negated: false, viaWrapper: false };
    case 'ordered':
      return { subject, rank: RANK.ordered, negated: false, viaWrapper: false };
    case 'partial':
      return { subject, rank: RANK.partial, negated: false, viaWrapper: false };
    case 'regex':
      return { subject, rank: regexRank(expected, name === 'matches' && a.family !== 'value'), negated: false, viaWrapper: false };
    case 'bound': {
      if (expected !== undefined && isZero(expected) && /^(>|greaterThan|isGreaterThan|toBeGreaterThan|above|gt|isAbove|greater_than|assertGreater|hasSizeGreaterThan)$/.test(name)) {
        return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
      }
      if (expected !== undefined && isOne(expected) && /^(>=|greaterThanOrEqualTo|isGreaterThanOrEqualTo|toBeGreaterThanOrEqual|least|gte|isAtLeast|greater_than_or_equal_to|assertGreaterEqual|hasSizeGreaterThanOrEqualTo)$/.test(name)) {
        return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
      }
      return { subject, rank: RANK.bound, negated: false, viaWrapper: false };
    }
    case 'nonEmpty':
      return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
    case 'exists':
      return { subject, rank: RANK.exists, negated: false, viaWrapper: false };
    case 'truthy':
      return readBoolean(subject, false);
    case 'falsy':
      return readBoolean(subject, true);
    case 'notEqual': {
      if (expected !== undefined && isNullish(expected)) return { subject, rank: RANK.exists, negated: false, viaWrapper: false };
      if (expected !== undefined && isZero(expected)) return { subject, rank: RANK.nonEmpty, negated: false, viaWrapper: false };
      return { subject, negated: true, viaWrapper: false };
    }
    case 'negative':
      return { subject, negated: true, viaWrapper: false };
    case 'in': {
      // `needle in container`. A front end that put the non literal operand first (`"x" in body` read as subject body)
      // already names the container; otherwise the container is the expected operand.
      const container = expected === undefined || (isLiteral(expected) && !isLiteral(subject)) ? subject : expected;
      return { subject: container, rank: RANK.partial, negated: false, viaWrapper: true };
    }
    default:
      return { subject, negated: calleeNegated, viaWrapper: false };
  }
}

/**
 * The assertion pins the subject to "no value": toBeNull, toBeUndefined, assertNull, `is None`, equality with null.
 * A head assertion that requires a value (it contains, matches, exceeds, exists) cannot be a weaker form of it: the
 * two accept disjoint values, so the expected value changed.
 */
export function expectsNullish(a: Assertion): boolean {
  if (a.kind === 'custom' || a.kind === 'interaction' || a.kind === 'exception') return false;
  if (CHAIN_NEGATED.test(a.callee) || NEGATED_CALLEE.test(a.callee)) return false;
  const name = matcherName(a).trim().replace(/\s+/g, '-');
  if (SHAPES[name] !== 'exact') return false;
  if (/^(toBeNull|toBeUndefined|null|undefined|isNull|isUndefined|assertNull|assertIsNone|is-none)$/.test(name)) return true;
  const subject = a.subject ?? '';
  // assertEquals(null, x) in JUnit puts the expected value first.
  return a.expected !== undefined && (isNullish(a.expected) || isNullish(subject));
}

function looksLikePredicate(subject: string): boolean {
  const call = wholeCall(squashSpace(subject));
  if (!call || call.receiver === undefined) return false;
  return PREDICATE_CALLS[call.name] !== undefined || call.name === 'test' || call.name === 'matches' || call.name === 'isEmpty';
}

/* ------------------------------------------------------------------------ */
/* Related subjects                                                          */
/* ------------------------------------------------------------------------ */

const STOP_WORDS = new Set(['get', 'set', 'self', 'this', 'cls', 'len', 'size', 'length', 'count', 'str', 'list', 'the', 'has', 'value', 'values', 'item', 'items', 'keys', 'new', 'assert', 'expect', 'actual', 'expected', 'result', 'results', 'res', 'response', 'data', 'obj', 'text']);

/** Identifier words of a subject: camelCase and snake_case split, lower cased, at least three letters, stop words removed. */
export function subjectWords(s: string): Set<string> {
  const out = new Set<string>();
  const ids = s.replace(/(["'`]).*?\1/g, ' ').match(/[A-Za-z_$][\w$]*/g) ?? [];
  for (const id of ids) {
    for (const w of id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$]+/)) {
      const lw = w.toLowerCase();
      if (lw.length >= 3 && !STOP_WORDS.has(lw) && !/^\d+$/.test(lw)) out.add(lw);
    }
  }
  return out;
}

/** Two subjects name the same thing in different words: they share an identifier word. */
export function relatedSubjects(a: string, b: string): boolean {
  const ca = compact(a);
  const cb = compact(b);
  // values[0] and values, body.status and body: one reads part of the other.
  if (ca && cb && (ca.startsWith(cb + '[') || ca.startsWith(cb + '.') || cb.startsWith(ca + '[') || cb.startsWith(ca + '.'))) return true;
  const wa = subjectWords(a);
  for (const w of subjectWords(b)) if (wa.has(w)) return true;
  return false;
}
