/**
 * Builds a TestInventory for one Java source file.
 *
 * The tree-sitter queries under queries/ find the candidates (annotated
 * methods, call chains, annotations, mock declarations). The tables in
 * frameworks.ts decide what each candidate means. This file joins the two.
 */
import {
  parseSource,
  countParseErrors,
  normaliseText,
  shortHash,
} from '@testwitness/core';
import type {
  Assertion,
  AssertionKind,
  CatchAll,
  FrameworkProfile,
  Node,
  Query,
  SkipMarker,
  TestCase,
  TestInventory,
} from '@testwitness/core';
import { loadJavaGrammar } from './grammar.js';
import {
  DEFAULT_FRAMEWORK,
  assertionFamilyImports,
  assertjDescribers,
  assertjStarters,
  assertjTerminals,
  awaitCalls,
  awaitilityTerminals,
  frameworkTables,
  hamcrestMatchers,
  junit4,
  junit5,
  junitAssertions,
  mockAnnotations,
  mockCalls,
  mockitoModes,
  mockitoVerifications,
  restAssuredTerminals,
  sleepCalls,
  snapshotTerminals,
  springMatchers,
  stateMatchers,
  testng,
  timeUnitMs,
  truthTerminals,
} from './frameworks.js';
import type { FrameworkTable, JavaFramework } from './frameworks.js';

/* ------------------------------------------------------------------------ */
/* Public types                                                              */
/* ------------------------------------------------------------------------ */

export interface SleepCall {
  /** Normalised call, for example `Thread.sleep` or `TimeUnit.SECONDS.sleep`. */
  callee: string;
  /** Milliseconds when the argument is a literal. */
  ms?: number;
  line: number;
  text: string;
}

/** Timing signals per test (spec T001 to T003). Not part of TestCase, exposed alongside it. */
export interface JavaTestTiming {
  qualifiedName: string;
  /** Explicit timeout in milliseconds from @Timeout, @Test(timeout=) or @Test(timeOut=). */
  timeoutMs?: number;
  /** Where the timeout came from, for example `@Timeout` or `@Test(timeout)`. */
  timeoutSource?: string;
  sleeps: SleepCall[];
  /** Number of Awaitility `await()` chains in the body. */
  awaits: number;
}

export interface JavaInventoryResult {
  inventory: TestInventory;
  timing: JavaTestTiming[];
}

/* ------------------------------------------------------------------------ */
/* Small node helpers                                                        */
/* ------------------------------------------------------------------------ */

interface ParsedAnnotation {
  /** Simple name, for example `Test` for `@org.junit.jupiter.api.Test`. */
  name: string;
  /** Full name as written. */
  fullName: string;
  /** Arguments by key. A single unnamed value is stored under `value`. */
  args: Map<string, Node>;
  node: Node;
  line: number;
}

function line(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

function simpleName(nameNode: Node): string {
  if (nameNode.type === 'scoped_identifier') {
    const n = nameNode.childForFieldName('name');
    return n ? n.text : nameNode.text;
  }
  return nameNode.text;
}

function parseAnnotation(node: Node): ParsedAnnotation | undefined {
  if (node.type !== 'marker_annotation' && node.type !== 'annotation') return undefined;
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return undefined;
  const args = new Map<string, Node>();
  const list = node.childForFieldName('arguments');
  if (list) {
    for (const child of list.namedChildren) {
      if (child.type === 'element_value_pair') {
        const key = child.childForFieldName('key');
        const value = child.childForFieldName('value');
        if (key && value) args.set(key.text, value);
      } else if (child.type !== 'line_comment' && child.type !== 'block_comment') {
        args.set('value', child);
      }
    }
  }
  return { name: simpleName(nameNode), fullName: nameNode.text, args, node, line: line(node) };
}

function annotationsOf(declaration: Node): ParsedAnnotation[] {
  const out: ParsedAnnotation[] = [];
  for (const child of declaration.namedChildren) {
    if (child.type !== 'modifiers') continue;
    for (const m of child.namedChildren) {
      const a = parseAnnotation(m);
      if (a) out.push(a);
    }
  }
  return out;
}

function modifierWords(declaration: Node): Set<string> {
  const words = new Set<string>();
  for (const child of declaration.namedChildren) {
    if (child.type !== 'modifiers') continue;
    for (let i = 0; i < child.childCount; i++) {
      const c = child.child(i);
      if (c && !c.isNamed) words.add(c.text);
    }
  }
  return words;
}

/** Unquote a Java string literal or text block. Returns undefined for non strings. */
function stringValue(node: Node | undefined): string | undefined {
  if (!node || node.type !== 'string_literal') return undefined;
  const parts: string[] = [];
  for (const c of node.namedChildren) {
    if (c.type === 'string_fragment' || c.type === 'multiline_string_fragment') parts.push(c.text);
    else if (c.type === 'escape_sequence') parts.push(c.text);
  }
  return parts.join('');
}

function isStringNode(node: Node | undefined): boolean {
  return !!node && node.type === 'string_literal';
}

/** `Foo.class` gives `Foo`; anything else gives its normalised text. */
function classLiteralName(node: Node): string {
  if (node.type === 'class_literal') {
    const t = node.namedChildren[0];
    if (t) return t.text;
  }
  return normaliseText(node.text);
}

const CONTAINER_TYPES = new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']);

/** Enclosing named containers, outermost first. Undefined when inside an anonymous class or a local class. */
function containersOf(method: Node): Node[] | undefined {
  const chain: Node[] = [];
  let cur = method.parent;
  while (cur) {
    if (cur.type === 'object_creation_expression' || cur.type === 'lambda_expression' || cur.type === 'block') return undefined;
    if (CONTAINER_TYPES.has(cur.type)) chain.unshift(cur);
    cur = cur.parent;
  }
  return chain;
}

function containerName(container: Node): string {
  return container.childForFieldName('name')?.text ?? '';
}

/* ------------------------------------------------------------------------ */
/* Framework detection                                                       */
/* ------------------------------------------------------------------------ */

interface ImportInfo {
  path: string;
  isStatic: boolean;
}

function collectImports(root: Node): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const node of root.namedChildren) {
    if (node.type !== 'import_declaration') continue;
    let isStatic = false;
    let path = '';
    let wildcard = false;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (c.type === 'static') isStatic = true;
      else if (c.type === 'scoped_identifier' || c.type === 'identifier') path = c.text;
      else if (c.type === 'asterisk') wildcard = true;
    }
    if (path) out.push({ path: wildcard ? `${path}.*` : path, isStatic });
  }
  return out;
}

function tableFor(name: JavaFramework): FrameworkTable {
  return frameworkTables.find((t) => t.name === name) ?? junit5;
}

export function detectFramework(imports: ImportInfo[], annotations: ParsedAnnotation[], profile: FrameworkProfile): JavaFramework {
  const matches = (t: FrameworkTable, path: string): boolean =>
    t.importPrefixes.some((p) => path.startsWith(p)) && !t.importExcludes.some((p) => path.startsWith(p));
  for (const t of frameworkTables) {
    if (imports.some((i) => matches(t, i.path))) return t.name;
  }
  // Fully qualified annotations carry the package with them.
  for (const a of annotations) {
    for (const t of frameworkTables) {
      if (matches(t, a.fullName)) return t.name;
    }
  }
  // Framework specific annotation shapes.
  const names = new Set(annotations.map((a) => a.name));
  if (['ParameterizedTest', 'RepeatedTest', 'TestFactory', 'Nested', 'Disabled', 'BeforeEach', 'AfterEach', 'DisplayName'].some((n) => names.has(n))) return 'junit5';
  if (['BeforeMethod', 'AfterMethod', 'DataProvider', 'BeforeSuite'].some((n) => names.has(n))) return 'testng';
  if (annotations.some((a) => a.name === 'Test' && ['enabled', 'expectedExceptions', 'dataProvider', 'timeOut', 'groups'].some((k) => a.args.has(k)))) return 'testng';
  if (['Ignore', 'Before', 'After', 'RunWith', 'Rule'].some((n) => names.has(n))) return 'junit4';
  if (annotations.some((a) => a.name === 'Test' && (a.args.has('expected') || a.args.has('timeout')))) return 'junit4';
  for (const t of frameworkTables) {
    if (profile.frameworks.has(t.name)) return t.name;
  }
  return DEFAULT_FRAMEWORK;
}

/* ------------------------------------------------------------------------ */
/* Call chains                                                               */
/* ------------------------------------------------------------------------ */

interface ChainCall {
  name: string;
  args: Node[];
  node: Node;
}

interface Chain {
  /** Qualifier before the first call, for example `Assertions`, `mockMvc`, `this`. */
  qualifier?: string;
  qualifierNode?: Node;
  calls: ChainCall[];
  top: Node;
}

function argsOf(call: Node): Node[] {
  const list = call.childForFieldName('arguments');
  return list ? list.namedChildren.filter((c) => c.type !== 'line_comment' && c.type !== 'block_comment') : [];
}

/** Climb to the outermost method_invocation of which `node` is the receiver. */
function outermostCall(node: Node): Node {
  let top = node;
  for (;;) {
    const parent = top.parent;
    if (!parent || parent.type !== 'method_invocation') break;
    const obj = parent.childForFieldName('object');
    if (!obj || obj.id !== top.id) break;
    top = parent;
  }
  return top;
}

function flattenChain(top: Node): Chain {
  const calls: ChainCall[] = [];
  let cur: Node | null = top;
  let qualifier: Node | undefined;
  while (cur) {
    if (cur.type === 'method_invocation') {
      const name = cur.childForFieldName('name')?.text ?? '';
      calls.unshift({ name, args: argsOf(cur), node: cur });
      cur = cur.childForFieldName('object');
    } else {
      qualifier = cur;
      cur = null;
    }
  }
  const chain: Chain = { calls, top };
  if (qualifier) {
    chain.qualifier = qualifier.text;
    chain.qualifierNode = qualifier;
  }
  return chain;
}

const STATEMENT_SUFFIX = '_statement';

function enclosingStatement(node: Node): Node {
  let cur: Node | null = node;
  while (cur) {
    if (cur.type.endsWith(STATEMENT_SUFFIX) || cur.type === 'local_variable_declaration') return cur;
    if (cur.type === 'block' || cur.type === 'method_declaration') break;
    cur = cur.parent;
  }
  return node;
}

/** True when the call sits inside the argument list of another call in the same statement. */
function nestedInArguments(node: Node): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.type === 'argument_list') return true;
    if (cur.type.endsWith(STATEMENT_SUFFIX) || cur.type === 'local_variable_declaration' || cur.type === 'block' || cur.type === 'method_declaration') return false;
    cur = cur.parent;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Assertion classification                                                  */
/* ------------------------------------------------------------------------ */

interface FileContext {
  framework: JavaFramework;
  table: FrameworkTable;
  imports: ImportInfo[];
  families: Set<string>;
  /** True when org.testng.Assert (actual, expected order) is in use. */
  testngAssert: boolean;
  /** Helpers defined in this file plus profile.extraAssertions. */
  helpers: Set<string>;
  extraAssertions: Set<string>;
  /** Every method name defined in this file, so a bare call to a local method without assertions is not trusted by name. */
  definedMethods: Set<string>;
}

/**
 * Method names that read as assertions: assert, check, verify, expect, should, validate followed by a camelCase
 * boundary (uppercase, underscore, digit or end), plus Spring's andExpect. `checkout` and `expected` do not match.
 */
const ASSERTION_NAME = /^(?:[aA]ssert|[cC]heck|[vV]erify|[eE]xpect|[sS]hould|[vV]alidate)(?:[A-Z_0-9]|$)|^andExpect(?:All)?$/;

const LITERAL_TYPES = new Set(['decimal_integer_literal', 'hex_integer_literal', 'octal_integer_literal', 'binary_integer_literal', 'decimal_floating_point_literal', 'hex_floating_point_literal', 'string_literal', 'character_literal', 'true', 'false', 'null_literal']);

export function looksLikeAssertionName(name: string): boolean {
  return ASSERTION_NAME.test(name);
}

function assertionFamilies(imports: ImportInfo[]): Set<string> {
  const out = new Set<string>();
  for (const i of imports) {
    for (const [prefix, family] of assertionFamilyImports) {
      if (i.path.startsWith(prefix)) out.add(family);
    }
  }
  return out;
}

function subjectText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  return normaliseText(node.text);
}

function isPlainReference(node: Node | undefined): boolean {
  return !!node && (node.type === 'identifier' || node.type === 'field_access' || node.type === 'this');
}

function makeAssertion(
  chain: Chain,
  callee: string,
  kind: AssertionKind,
  family: string | undefined,
  strength: number | undefined,
  subjectNode: Node | undefined,
  anchor: Node = chain.top,
  expectedNode?: Node | string,
): Assertion {
  const stmt = enclosingStatement(anchor);
  const a: Assertion = {
    callee,
    text: stmt.text.trim(),
    line: line(anchor),
    kind,
  };
  const subject = subjectText(subjectNode);
  if (subject !== undefined) a.subject = subject;
  if (family !== undefined) a.family = family;
  if (strength !== undefined) a.strength = strength;
  const expected = typeof expectedNode === 'string' ? expectedNode : expectedNode ? classLiteralName(expectedNode) : undefined;
  if (expected !== undefined) a.expected = expected;
  return a;
}

/** Last call of the chain that is not a pure describer. */
function terminalOf(calls: ChainCall[]): ChainCall | undefined {
  for (let i = calls.length - 1; i >= 1; i--) {
    const c = calls[i];
    if (c && !assertjDescribers.has(c.name)) return c;
  }
  return undefined;
}

function outerMatcherName(node: Node | undefined): string | undefined {
  if (!node || node.type !== 'method_invocation') return undefined;
  const name = node.childForFieldName('name')?.text;
  if (name === 'is') {
    const inner = argsOf(node)[0];
    if (inner && inner.type === 'method_invocation') return outerMatcherName(inner);
  }
  return name;
}

function springMatcherKey(node: Node | undefined): string | undefined {
  if (!node || node.type !== 'method_invocation') return undefined;
  const chain = flattenChain(node);
  const first = chain.calls[0];
  const last = chain.calls[chain.calls.length - 1];
  if (!first || !last) return undefined;
  if (chain.calls.length === 1) return first.name;
  return `${first.name}.${last.name}`;
}

function mockitoStrength(modeArg: Node | undefined, base: number): number {
  if (!modeArg || modeArg.type !== 'method_invocation') return base;
  const name = modeArg.childForFieldName('name')?.text ?? '';
  return mockitoModes[name] ?? base;
}

/** Strip the message argument, which JUnit 4 puts first and JUnit 5 and TestNG put last. */
function stripMessage(args: Node[], arity: number, table: FrameworkTable): Node[] {
  if (args.length <= arity) return args;
  const first = args[0];
  const last = args[args.length - 1];
  const isMessage = (n: Node | undefined): boolean => isStringNode(n) || n?.type === 'lambda_expression' || (n?.type === 'identifier' && /message|msg|reason/i.test(n.text));
  if (table.messagePosition === 'first' && isMessage(first) && !isStringNode(last)) return args.slice(1);
  if (isMessage(last)) return args.slice(0, -1);
  if (table.messagePosition === 'first' && isMessage(first)) return args.slice(1);
  return args;
}

const UNARY_ASSERTS = new Set(['assertTrue', 'assertFalse', 'assertNull', 'assertNotNull', 'assertDoesNotThrow']);
const BINARY_ASSERTS = new Set(['assertEquals', 'assertNotEquals', 'assertSame', 'assertNotSame', 'assertArrayEquals', 'assertIterableEquals', 'assertLinesMatch', 'assertEqualsDeep', 'assertEqualsNoOrder']);
const TYPE_FIRST_ASSERTS = new Set(['assertThrows', 'assertThrowsExactly', 'expectThrows', 'assertInstanceOf', 'assertTimeout', 'assertTimeoutPreemptively']);

function classifyJUnit(chain: Chain, ctx: FileContext): Assertion[] {
  const root = chain.calls[0];
  if (!root) return [];
  const shape = junitAssertions[root.name];
  if (!shape) return [];
  const useTestng = ctx.testngAssert || (ctx.framework === 'testng' && !ctx.imports.some((i) => i.path.startsWith('org.junit')));
  const table = useTestng ? testng : ctx.framework === 'junit4' ? junit4 : junit5;
  const family = useTestng ? 'testng' : 'junit';
  let kind = shape.kind;
  let strength = shape.strength;
  let subject: Node | undefined;
  let expected: Node | undefined;
  if (UNARY_ASSERTS.has(root.name)) {
    const args = stripMessage(root.args, 1, table);
    subject = args[0];
    if ((root.name === 'assertTrue' || root.name === 'assertFalse') && subject) {
      if (subject.type === 'instanceof_expression') {
        kind = 'smoke';
        strength = 1;
      } else if (subject.type === 'binary_expression' && /\bnull\b/.test(subject.text)) {
        kind = 'smoke';
        strength = 1;
      } else if (subject.type === 'true' || subject.type === 'false') {
        strength = 0;
      }
    }
  } else if (BINARY_ASSERTS.has(root.name)) {
    const args = stripMessage(root.args, root.name === 'assertArrayEquals' && root.args.length >= 3 && !isStringNode(root.args[0]) && !isStringNode(root.args[root.args.length - 1]) ? 3 : 2, table);
    subject = table.actualArgument === 'first' ? args[0] : args[1];
    expected = table.actualArgument === 'first' ? args[1] : args[0];
  } else if (TYPE_FIRST_ASSERTS.has(root.name)) {
    const args = stripMessage(root.args, 2, table);
    subject = args[1];
    expected = args[0];
  }
  return [makeAssertion(chain, root.name, kind, family, strength, subject, chain.top, expected)];
}

function classifyChain(chain: Chain, ctx: FileContext): Assertion[] {
  const calls = chain.calls;
  const root = calls[0];
  if (!root) return [];
  const last = calls[calls.length - 1]!;
  const names = calls.map((c) => c.name);
  const qualifier = chain.qualifier;

  // Spring MockMvc: one assertion per andExpect in the chain.
  const expectCalls = calls.filter((c) => c.name === 'andExpect' || c.name === 'andExpectAll');
  if (expectCalls.length > 0 && (ctx.families.has('spring') || names.includes('perform'))) {
    const out: Assertion[] = [];
    const performIndex = names.indexOf('perform');
    const subject = performIndex >= 0 ? calls[performIndex]?.node : chain.qualifierNode;
    for (const call of expectCalls) {
      const matcherArgs = call.name === 'andExpectAll' ? call.args : call.args.slice(0, 1);
      for (const m of matcherArgs) {
        const key = springMatcherKey(m);
        const shape = key ? springMatchers[key] : undefined;
        out.push(makeAssertion(chain, key ? `andExpect.${key}` : 'andExpect', shape?.kind ?? 'value', 'spring', shape?.strength ?? 2, subject, call.node, m));
      }
      if (matcherArgs.length === 0) out.push(makeAssertion(chain, 'andExpect', 'value', 'spring', 2, subject, call.node));
    }
    return out;
  }

  // REST Assured: given()...then().statusCode(200).body(...)
  const thenIndex = names.findIndex((n, i) => n === 'then' && calls[i]!.args.length === 0 && i > 0);
  if (thenIndex > 0 && (ctx.families.has('restassured') || names.includes('given') || names.includes('when'))) {
    const out: Assertion[] = [];
    const subject = calls[thenIndex]?.node.childForFieldName('object') ?? undefined;
    for (const call of calls.slice(thenIndex + 1)) {
      const shape = restAssuredTerminals[call.name];
      if (!shape) continue;
      const expected = call.args.length ? normaliseText(call.args.map((a) => a.text).join(', ')) : undefined;
      out.push(makeAssertion(chain, `then.${call.name}`, shape.kind, 'restassured', shape.strength, subject, call.node, expected));
    }
    return out;
  }

  // Awaitility
  if (awaitCalls.has(root.name) && root.args.length === 0 && (qualifier === undefined || /Awaitility$/.test(qualifier))) {
    const term = calls.slice(1).reverse().find((c) => awaitilityTerminals[c.name]);
    if (!term) return [];
    const shape = awaitilityTerminals[term.name]!;
    return [makeAssertion(chain, `await.${term.name}`, shape.kind, 'awaitility', shape.strength, term.args[0])];
  }

  // Approval tests and snapshot libraries.
  if (qualifier && /Approvals$/.test(qualifier) && root.name.startsWith('verify')) {
    return [makeAssertion(chain, `Approvals.${root.name}`, 'snapshot', 'approvals', 3, root.args[0])];
  }
  if (snapshotTerminals.has(last.name)) {
    return [makeAssertion(chain, `${root.name}.${last.name}`, 'snapshot', 'snapshot', 3, root.args[0])];
  }

  // Mockito BDD: then(mock).should(times(2)).go()
  if (root.name === 'then' && root.args.length === 1 && (qualifier === undefined || /BDDMockito$/.test(qualifier))) {
    const should = calls.find((c) => c.name.startsWith('should'));
    if (should) {
      const shape = mockitoVerifications[should.name] ?? mockitoVerifications['should']!;
      return [makeAssertion(chain, `then.${should.name}`, 'interaction', 'mockito', mockitoStrength(should.args[0], shape.strength), root.args[0])];
    }
  }

  // Mockito verify(mock, times(n)).method(), inOrder.verify(mock).method(), verifyNoMoreInteractions(mocks)
  if (root.name !== 'should' && mockitoVerifications[root.name] && (qualifier === undefined || /Mockito$|inOrder|InOrder|order/i.test(qualifier))) {
    const shape = mockitoVerifications[root.name]!;
    const callee = qualifier && /inOrder|InOrder|order/i.test(qualifier) ? `inOrder.${root.name}` : root.name;
    return [makeAssertion(chain, callee, 'interaction', 'mockito', mockitoStrength(root.args[1], shape.strength), root.args[0])];
  }

  // AssertJ, Truth and Hamcrest. BDDAssertions.then(actual) is assertThat under another name.
  const bddThen = root.name === 'then' && root.args.length === 1 && calls.length > 1 && ctx.families.has('assertj') && (qualifier === undefined || /Assertions$/.test(qualifier));
  const starter = assertjStarters[root.name] ?? (root.name === 'assertWithMessage' || bddThen ? {} : undefined);
  if (starter) {
    if (calls.length === 1) {
      // Hamcrest: assertThat(actual, matcher) or assertThat(reason, actual, matcher)
      if (root.name === 'assertThat' && root.args.length >= 2) {
        const matcher = root.args[root.args.length - 1];
        const actual = root.args[root.args.length - 2];
        const matcherName = outerMatcherName(matcher);
        const shape = matcherName ? hamcrestMatchers[matcherName] : undefined;
        let kind: AssertionKind = shape?.kind ?? 'value';
        if (kind === 'value' && matcherName && stateMatchers.has(matcherName) && isPlainReference(actual)) kind = 'state';
        return [makeAssertion(chain, matcherName ? `assertThat.${matcherName}` : 'assertThat', kind, 'hamcrest', shape?.strength ?? 2, actual, chain.top, matcher)];
      }
      return [];
    }
    const terminal = terminalOf(calls);
    if (!terminal) return [];
    const family = ctx.families.has('truth') && !ctx.families.has('assertj') ? 'truth' : 'assertj';
    const table = family === 'truth' ? truthTerminals : assertjTerminals;
    const thatCall = root.name === 'assertWithMessage' ? calls.find((c) => c.name === 'that') : root;
    const starterName = bddThen ? 'assertThat' : root.name;
    const subject = thatCall?.args[0];
    let shape = table[terminal.name] ?? { kind: 'value' as AssertionKind, strength: 2 };
    if (starter.kind === 'exception') {
      shape = { kind: 'exception', strength: shape.kind === 'exception' ? Math.max(shape.strength, starter.strength ?? 3) : (starter.strength ?? 3) };
    } else if (starter.kind === 'smoke') {
      shape = { kind: 'smoke', strength: starter.strength ?? 1 };
    } else if (root.name === 'assertThatCode' && terminal.name !== 'doesNotThrowAnyException') {
      shape = { kind: 'exception', strength: shape.kind === 'exception' ? shape.strength : 3 };
    }
    let kind = shape.kind;
    if (kind === 'value' && stateMatchers.has(terminal.name) && isPlainReference(subject)) kind = 'state';
    const expected = terminal.args.length ? normaliseText(terminal.args.map((a) => a.text).join(', ')) : undefined;
    return [makeAssertion(chain, `${starterName}.${terminal.name}`, kind, family, shape.strength, subject, chain.top, expected)];
  }

  // JUnit, TestNG: one call, optional Assert/Assertions qualifier.
  if (calls.length === 1 && (qualifier === undefined || /Assert(ions)?$|Assert\.|AssertJUnit$/.test(qualifier))) {
    const found = classifyJUnit(chain, ctx);
    if (found.length) return found;
  }

  // Custom helpers defined in this file, plus profile.extraAssertions.
  if (calls.length === 1) {
    const dotted = qualifier ? `${qualifier}.${root.name}` : root.name;
    const local = qualifier === undefined || qualifier === 'this';
    if ((local && ctx.helpers.has(root.name)) || ctx.extraAssertions.has(root.name) || ctx.extraAssertions.has(dotted)) {
      return [makeAssertion(chain, dotted, 'custom', undefined, undefined, root.args[0])];
    }
  }

  // Name based custom assertions: ts.assertResult(1), expectAssertionError(...), verifyNoDrift(), .test().assertComplete().
  // A bare call to a method defined in this file is trusted only when that method asserts (it is then a helper above).
  // A call nested in the arguments of another call (shouldHaveParameter(...) inside hasMessage(...)) is not a statement
  // level oracle and is left to the outer call.
  if (nestedInArguments(chain.top)) return [];
  const named = calls.filter((c, i) => {
    if (!looksLikeAssertionName(c.name)) return false;
    const bare = i === 0 && (qualifier === undefined || qualifier === 'this');
    return !(bare && ctx.definedMethods.has(c.name) && !ctx.helpers.has(c.name));
  });
  if (named.length) {
    // Subject is the receiver when there is one, else the first non literal argument: a literal subject with no expected
    // operand would read as a tautology in core (assertResult(1) is not assertTrue(1)).
    return named.map((c) => {
      const receiver = c.node.childForFieldName('object') ?? undefined;
      const arg = c.args.find((a) => !LITERAL_TYPES.has(a.type));
      return makeAssertion(chain, c.name, 'custom', undefined, undefined, receiver ?? arg, c.node);
    });
  }
  return [];
}

/** Collect assertions in a body. Nested lambdas (assertAll, assertThrows) are visited too. */
function collectAssertions(body: Node, query: Query, ctx: FileContext): Assertion[] {
  const seen = new Set<number>();
  const out: Assertion[] = [];
  for (const match of query.matches(body)) {
    const call = match.captures.find((c) => c.name === 'call')?.node;
    if (!call) continue;
    // Skip calls that live inside an anonymous class body or a local class: those are not test statements.
    if (insideLocalClass(call, body)) continue;
    const top = outermostCall(call);
    if (seen.has(top.id)) continue;
    seen.add(top.id);
    out.push(...classifyChain(flattenChain(top), ctx));
  }
  for (const stmt of body.descendantsOfType('assert_statement')) {
    if (insideLocalClass(stmt, body)) continue;
    const expr = stmt.namedChildren[0];
    out.push({ callee: 'assert', text: stmt.text.trim(), line: line(stmt), kind: 'value', ...(expr ? { subject: normaliseText(expr.text) } : {}) });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

function insideLocalClass(node: Node, stop: Node): boolean {
  let cur = node.parent;
  while (cur && cur.id !== stop.id) {
    if (cur.type === 'class_body' || cur.type === 'interface_body' || cur.type === 'enum_body') return true;
    cur = cur.parent;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Statements                                                                */
/* ------------------------------------------------------------------------ */

const NON_RECURSIVE = new Set(['lambda_expression', 'class_body', 'interface_body', 'enum_body', 'method_declaration', 'class_declaration']);

function isTrivialStatement(node: Node): boolean {
  if (node.type === 'return_statement') return node.namedChildren.filter((c) => c.type !== 'line_comment' && c.type !== 'block_comment').length === 0;
  if (node.type === 'expression_statement') {
    const expr = node.namedChildren[0];
    return !expr || expr.type === 'string_literal';
  }
  return false;
}

/** Executable statements in a body, recursing into nested blocks but not into lambdas or local classes. */
export function countStatements(body: Node): number {
  let n = 0;
  const visit = (node: Node): void => {
    for (const child of node.namedChildren) {
      if (NON_RECURSIVE.has(child.type)) continue;
      const forInit = child.type === 'local_variable_declaration' && node.type === 'for_statement';
      const isStatement = !forInit && (child.type.endsWith(STATEMENT_SUFFIX) || child.type === 'local_variable_declaration' || child.type === 'switch_expression');
      if (isStatement && child.type !== 'block' && !isTrivialStatement(child)) n++;
      visit(child);
    }
  };
  visit(body);
  return n;
}

/* ------------------------------------------------------------------------ */
/* Markers                                                                   */
/* ------------------------------------------------------------------------ */

function reasonOf(a: ParsedAnnotation, keys: string[] = ['value', 'reason', 'disabledReason']): string | undefined {
  for (const k of keys) {
    const v = stringValue(a.args.get(k));
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function isLiteralFalse(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === 'false') return true;
  const s = stringValue(node);
  return s !== undefined && s.trim() === 'false';
}

function isLiteralTrue(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === 'true') return true;
  const s = stringValue(node);
  return s !== undefined && s.trim() === 'true';
}

/** Exception types that only an assertion raises. Expecting one of them is an expected failure, not an exception test. */
const ASSERTION_FAILURE_TYPES = /(^|\.)(AssertionError|AssertionFailedError|ComparisonFailure|MultipleFailuresError)$/;

/** Class names from `@Test(expected = X.class)` or `@Test(expectedExceptions = { X.class, Y.class })`. */
function expectedExceptionNames(value: Node): string[] {
  return value.type === 'element_value_array_initializer' ? value.namedChildren.map(classLiteralName) : [classLiteralName(value)];
}

function markersFromAnnotations(annotations: ParsedAnnotation[], framework: JavaFramework): SkipMarker[] {
  const out: SkipMarker[] = [];
  const rules = new Map<string, { kind: SkipMarker['kind']; constant: boolean }>();
  for (const t of frameworkTables) for (const r of t.skipAnnotations) rules.set(r.name, r);
  for (const a of annotations) {
    const rule = rules.get(a.name);
    if (rule) {
      const m: SkipMarker = { marker: `@${a.name}`, kind: rule.kind, line: a.line };
      if (rule.constant) m.constant = true;
      else if (a.name === 'EnabledIf' && isLiteralFalse(a.args.get('value'))) m.constant = true;
      else if (a.name === 'DisabledIf' && isLiteralTrue(a.args.get('value'))) m.constant = true;
      const reason = reasonOf(a);
      if (reason !== undefined && !(a.name === 'EnabledIf' || a.name === 'DisabledIf')) m.reason = reason;
      if ((a.name === 'EnabledIf' || a.name === 'DisabledIf') && stringValue(a.args.get('disabledReason')) !== undefined) m.reason = stringValue(a.args.get('disabledReason'))!;
      out.push(m);
      continue;
    }
    if (a.name === 'Test') {
      const t = tableFor(framework);
      const skipAttr = t.testAttributeSkip ?? testng.testAttributeSkip!;
      const v = a.args.get(skipAttr.key);
      if (v) {
        if (v.text === skipAttr.skippedWhen) {
          out.push({ marker: `@Test(${skipAttr.key}=${skipAttr.skippedWhen})`, kind: 'skip', constant: true, line: a.line });
        } else if (v.type !== 'true') {
          out.push({ marker: `@Test(${skipAttr.key}=)`, kind: 'conditional-skip', line: a.line });
        }
      }
      // JUnit 4 and TestNG have no xfail marker. Expecting an assertion failure type is the idiom used instead:
      // the test then passes exactly when its own assertions fail.
      for (const key of [...junit4.expectedExceptionKeys, ...testng.expectedExceptionKeys]) {
        const e = a.args.get(key);
        if (!e) continue;
        const names = expectedExceptionNames(e);
        const failure = names.find((n) => ASSERTION_FAILURE_TYPES.test(n));
        if (failure) out.push({ marker: `@Test(${key}=${failure})`, kind: 'xfail', constant: true, line: a.line });
      }
    }
  }
  return out;
}

/** Assumptions or SkipException as the first statement of a body. */
function markersFromFirstStatement(body: Node, framework: JavaFramework): SkipMarker[] {
  const first = body.namedChildren.find((c) => c.type !== 'line_comment' && c.type !== 'block_comment');
  if (!first) return [];
  if (first.type === 'throw_statement') {
    const creation = first.namedChildren.find((c) => c.type === 'object_creation_expression');
    const type = creation?.childForFieldName('type');
    if (type && /SkipException$/.test(type.text)) {
      const m: SkipMarker = { marker: 'throw new SkipException', kind: 'skip', constant: true, line: line(first) };
      const reason = stringValue(creation ? argsOf(creation)[0] : undefined);
      if (reason !== undefined) m.reason = reason;
      return [m];
    }
    return [];
  }
  if (first.type !== 'expression_statement') return [];
  const expr = first.namedChildren[0];
  if (!expr || expr.type !== 'method_invocation') return [];
  const chain = flattenChain(expr);
  const root = chain.calls[0];
  if (!root || chain.calls.length !== 1) return [];
  const assumptions = new Set<string>();
  for (const t of frameworkTables) for (const a of t.assumptions) assumptions.add(a);
  if (!assumptions.has(root.name)) return [];
  if (chain.qualifier !== undefined && !/Assum(e|ptions)$/.test(chain.qualifier)) return [];
  void framework;
  const arg = root.args[0];
  const m: SkipMarker = { marker: root.name, kind: 'conditional-skip', line: line(first) };
  if (root.name === 'abort') {
    m.kind = 'skip';
    m.constant = true;
    m.marker = 'Assumptions.abort';
    const reason = stringValue(arg);
    if (reason !== undefined) m.reason = reason;
  } else if (root.name === 'assumeTrue' && isLiteralFalse(arg)) {
    m.kind = 'skip';
    m.constant = true;
    m.marker = 'assumeTrue(false)';
  } else if (root.name === 'assumeFalse' && isLiteralTrue(arg)) {
    m.kind = 'skip';
    m.constant = true;
    m.marker = 'assumeFalse(true)';
  }
  const msg = root.args.find((a, i) => i > 0 && isStringNode(a));
  const reason = stringValue(msg);
  if (reason !== undefined && m.reason === undefined) m.reason = reason;
  return [m];
}

/* ------------------------------------------------------------------------ */
/* Parameters, mocks, timing                                                 */
/* ------------------------------------------------------------------------ */

function countArrayOrSingle(node: Node | undefined): number {
  if (!node) return 0;
  if (node.type === 'element_value_array_initializer') {
    return node.namedChildren.filter((c) => c.type !== 'line_comment' && c.type !== 'block_comment').length;
  }
  return 1;
}

function countTextBlock(node: Node | undefined): number {
  const s = stringValue(node);
  if (s === undefined) return 0;
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#')).length;
}

export function parameterCountOf(annotations: ParsedAnnotation[], table: FrameworkTable): number | undefined {
  let total = 0;
  let found = false;
  for (const a of annotations) {
    if (a.name === 'RepeatedTest') {
      const v = a.args.get('value');
      if (v && /^\d+$/.test(v.text)) {
        total += Number(v.text);
        found = true;
      } else if (v) {
        return undefined;
      }
      continue;
    }
    const mode = table.parameterSources[a.name] ?? junit5.parameterSources[a.name];
    if (!mode) continue;
    if (mode === 'dynamic') return undefined;
    found = true;
    if (a.name === 'NullSource' || a.name === 'EmptySource') total += 1;
    else if (a.name === 'NullAndEmptySource') total += 2;
    else if (a.name === 'EnumSource') {
      const names = a.args.get('names');
      if (!names) return undefined;
      total += countArrayOrSingle(names);
    } else if (a.name === 'CsvSource') {
      const block = a.args.get('textBlock');
      if (block) total += countTextBlock(block);
      else total += countArrayOrSingle(a.args.get('value'));
      if (a.args.get('useHeadersInDisplayName')?.type === 'true') total -= 1;
    } else {
      // @ValueSource(ints = {1, 2}) and friends: any key except the known options.
      for (const [key, value] of a.args) {
        if (key === 'value' || !['delimiter', 'delimiterString', 'emptyValue', 'nullValues', 'ignoreLeadingAndTrailingWhitespace', 'quoteCharacter', 'maxCharsPerColumn'].includes(key)) {
          total += countArrayOrSingle(value);
        }
      }
    }
  }
  return found ? total : undefined;
}

/** True when the test runs more than once from a source: @ParameterizedTest, @TestTemplate, @RepeatedTest, TestNG dataProvider. */
export function isParameterised(annotations: ParsedAnnotation[]): boolean {
  for (const a of annotations) {
    if (a.name === 'ParameterizedTest' || a.name === 'TestTemplate' || a.name === 'RepeatedTest') return true;
    if (a.name === 'Test' && a.args.has('dataProvider')) return true;
    if (a.name === 'Parameters' || a.name === 'DataProvider') return true;
  }
  return false;
}

const CATCH_ALL_TYPES = new Set(['Exception', 'Throwable', 'RuntimeException', 'Error']);

/** Catch type text, with generics and package prefixes stripped per union member. */
function isCatchAllType(typeText: string): boolean {
  return typeText
    .split('|')
    .map((t) => t.trim().split('.').pop() ?? '')
    .some((t) => CATCH_ALL_TYPES.has(t));
}

const CATCH_ESCAPES = /\bthrow\b|\bfail\s*\(|\bAssert\.fail\b|\bassert[A-Za-z_]*\s*\(|\bassertThat\b|\bexpect[A-Za-z_]*\s*\(/;

/** Try statements in a body whose catch takes Exception, Throwable, RuntimeException or Error (E001). Lambdas and local classes are not visited. */
export function collectCatchAlls(body: Node): CatchAll[] {
  const out: CatchAll[] = [];
  const visit = (node: Node): void => {
    for (const child of node.namedChildren) {
      if (NON_RECURSIVE.has(child.type)) continue;
      if (child.type === 'try_statement' || child.type === 'try_with_resources_statement') {
        const block = child.childForFieldName('body');
        const first = block?.namedChildren.find((c) => c.type !== 'line_comment' && c.type !== 'block_comment');
        const snippet = normaliseText((first ?? block ?? child).text).slice(0, 120);
        for (const clause of child.namedChildren) {
          if (clause.type !== 'catch_clause') continue;
          const param = clause.namedChildren.find((c) => c.type === 'catch_formal_parameter');
          const typeNode = param?.namedChildren.find((c) => c.type === 'catch_type');
          const binding = normaliseText(typeNode?.text ?? '');
          if (!binding || !isCatchAllType(binding)) continue;
          const catchBody = clause.childForFieldName('body') ?? clause.namedChildren.find((c) => c.type === 'block');
          const swallows = !CATCH_ESCAPES.test(catchBody?.text ?? '');
          out.push({ line: line(clause), binding, swallows, snippet });
        }
      }
      visit(child);
    }
  };
  visit(body);
  return out;
}

function mockTarget(typeText: string, partial: boolean): string {
  const t = normaliseText(typeText);
  return partial ? `spy:${t}` : t;
}

function fieldMocks(container: Node): string[] {
  const out: string[] = [];
  const body = container.childForFieldName('body');
  if (!body) return out;
  for (const member of body.namedChildren) {
    if (member.type !== 'field_declaration') continue;
    const type = member.childForFieldName('type');
    if (!type) continue;
    for (const a of annotationsOf(member)) {
      const rule = mockAnnotations.find((r) => r.name === a.name);
      if (rule) out.push(mockTarget(type.text, rule.partial));
    }
  }
  return out;
}

function bodyMocks(body: Node, query: Query): string[] {
  const out: string[] = [];
  for (const match of query.matches(body)) {
    const call = match.captures.find((c) => c.name === 'mock.invocation')?.node;
    if (!call) continue;
    const name = call.childForFieldName('name')?.text ?? '';
    const rule = mockCalls[name];
    if (!rule) continue;
    const obj = call.childForFieldName('object');
    if (obj && !/Mockito$/.test(obj.text)) continue;
    const arg = argsOf(call)[0];
    if (!arg) continue;
    out.push(mockTarget(classLiteralName(arg), rule.partial));
  }
  return out;
}

function timeoutFrom(annotations: ParsedAnnotation[], table: FrameworkTable): { ms: number; source: string } | undefined {
  for (const a of annotations) {
    if (a.name === 'Timeout') {
      const v = a.args.get('value');
      if (!v || !/^\d+(_\d+)*L?$/.test(v.text)) return { ms: Number.NaN, source: '@Timeout' };
      const n = Number(v.text.replace(/_/g, '').replace(/L$/, ''));
      const unit = a.args.get('unit');
      const unitName = unit ? unit.text.split('.').pop() ?? 'SECONDS' : 'SECONDS';
      return { ms: n * (timeUnitMs[unitName] ?? 1000), source: '@Timeout' };
    }
    if (a.name === 'Test') {
      const key = table.timeoutAttribute ?? 'timeout';
      const v = a.args.get(key) ?? a.args.get('timeout') ?? a.args.get('timeOut');
      if (v) {
        const n = /^\d+(_\d+)*L?$/.test(v.text) ? Number(v.text.replace(/_/g, '').replace(/L$/, '')) : Number.NaN;
        return { ms: n, source: `@Test(${key})` };
      }
    }
  }
  return undefined;
}

function sleepsIn(body: Node): { sleeps: SleepCall[]; awaits: number } {
  const sleeps: SleepCall[] = [];
  let awaits = 0;
  for (const call of body.descendantsOfType('method_invocation')) {
    const name = call.childForFieldName('name')?.text ?? '';
    const obj = call.childForFieldName('object');
    if (name === 'sleep' && obj) {
      const q = obj.text;
      const rule = sleepCalls.find((r) => (r.qualifier.endsWith('.*') ? q.startsWith(r.qualifier.slice(0, -1)) : q === r.qualifier || q.endsWith(`.${r.qualifier}`)));
      if (!rule) continue;
      const arg = argsOf(call)[0];
      const s: SleepCall = { callee: `${q}.sleep`, line: line(call), text: enclosingStatement(call).text.trim() };
      if (arg && /^\d+(_\d+)*L?$/.test(arg.text)) {
        const n = Number(arg.text.replace(/_/g, '').replace(/L$/, ''));
        const unit = rule.unit === 'ms' ? 1 : timeUnitMs[q.split('.').pop() ?? ''] ?? Number.NaN;
        if (!Number.isNaN(unit)) s.ms = n * unit;
      }
      sleeps.push(s);
    } else if (!obj && awaitCalls.has(name) && argsOf(call).length === 0) {
      const top = outermostCall(call);
      if (top.id !== call.id) awaits++;
    }
  }
  return { sleeps, awaits };
}

/* ------------------------------------------------------------------------ */
/* Test discovery                                                            */
/* ------------------------------------------------------------------------ */

interface MethodInfo {
  node: Node;
  name: string;
  body: Node;
  annotations: ParsedAnnotation[];
  containers: Node[];
  modifiers: Set<string>;
}

function methodInfo(node: Node): MethodInfo | undefined {
  const name = node.childForFieldName('name')?.text;
  const body = node.childForFieldName('body');
  if (!name || !body) return undefined;
  const containers = containersOf(node);
  if (!containers) return undefined;
  return { node, name, body, annotations: annotationsOf(node), containers, modifiers: modifierWords(node) };
}

function isTestMethod(m: MethodInfo, framework: JavaFramework): boolean {
  const testNames = new Set<string>();
  for (const t of frameworkTables) for (const n of t.testAnnotations) testNames.add(n);
  const lifecycle = new Set<string>();
  for (const t of frameworkTables) for (const n of t.lifecycleAnnotations) lifecycle.add(n);
  if (m.annotations.some((a) => testNames.has(a.name))) return true;
  if (framework === 'testng') {
    // TestNG class level @Test makes every public instance method a test.
    const owner = m.containers[m.containers.length - 1];
    if (owner && annotationsOf(owner).some((a) => a.name === 'Test')) {
      if (m.modifiers.has('static')) return false;
      if (!m.modifiers.has('public')) return false;
      if (m.annotations.some((a) => lifecycle.has(a.name))) return false;
      return true;
    }
  }
  return false;
}

function isLifecycle(m: MethodInfo): boolean {
  const lifecycle = new Set<string>();
  for (const t of frameworkTables) for (const n of t.lifecycleAnnotations) lifecycle.add(n);
  return m.annotations.some((a) => lifecycle.has(a.name));
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export async function buildJavaInventory(path: string, source: string, profile: FrameworkProfile): Promise<JavaInventoryResult> {
  const { language, queries } = await loadJavaGrammar();
  const tree = parseSource(language, source);
  const root = tree.rootNode;
  try {
    const imports = collectImports(root);
    const allAnnotations: ParsedAnnotation[] = [];
    for (const match of queries.markers.matches(root)) {
      const node = match.captures.find((c) => c.name === 'marker')?.node;
      if (!node) continue;
      const a = parseAnnotation(node);
      if (a) allAnnotations.push(a);
    }
    const framework = detectFramework(imports, allAnnotations, profile);
    const table = tableFor(framework);
    const extraAssertions = new Set(profile.extraAssertions);
    const testngAssert = imports.some((i) => /^org\.testng\.Assert(\.|$)/.test(i.path));
    const ctx: FileContext = {
      framework,
      table,
      imports,
      families: assertionFamilies(imports),
      testngAssert,
      helpers: new Set<string>(),
      extraAssertions,
      definedMethods: new Set<string>(),
    };

    // All methods with a body, outside anonymous and local classes.
    const methods: MethodInfo[] = [];
    for (const node of root.descendantsOfType('method_declaration')) {
      const info = methodInfo(node);
      if (info) methods.push(info);
    }
    const testMethods = methods.filter((m) => isTestMethod(m, framework));
    const testIds = new Set(testMethods.map((m) => m.node.id));
    ctx.definedMethods = new Set(methods.map((m) => m.name));

    // Assertion helpers: non test, non lifecycle methods whose body asserts (one level deep).
    const helpers = new Set<string>();
    for (const m of methods) {
      if (testIds.has(m.node.id) || isLifecycle(m)) continue;
      if (collectAssertions(m.body, queries.assertions, ctx).length > 0) helpers.add(m.name);
    }
    ctx.helpers = helpers;

    const tests: TestCase[] = [];
    const timing: JavaTestTiming[] = [];
    for (const m of testMethods) {
      const containerNames = m.containers.map(containerName);
      const qualifiedName = containerNames.length ? `${containerNames.join('$')}#${m.name}` : m.name;

      const classAnnotations = m.containers.flatMap((c) => annotationsOf(c));
      const markers = [
        ...markersFromAnnotations(classAnnotations, framework),
        ...markersFromAnnotations(m.annotations, framework),
        ...markersFromFirstStatement(m.body, framework),
      ];

      const assertions = collectAssertions(m.body, queries.assertions, ctx);
      for (const a of m.annotations) {
        if (a.name !== 'Test') continue;
        for (const key of [...junit4.expectedExceptionKeys, ...testng.expectedExceptionKeys]) {
          const v = a.args.get(key);
          if (!v) continue;
          const names = expectedExceptionNames(v);
          // No `expected` field: the subject is the exception type and there is no second operand. Setting both to the
          // same text made core read the annotation as a tautology (subject equals expected).
          assertions.push({ callee: `@Test(${key})`, subject: names.join(', '), text: a.node.text.trim(), line: a.line, kind: 'exception', family: 'junit', strength: 3 });
        }
      }
      assertions.sort((x, y) => x.line - y.line);

      const mocks = Array.from(new Set([...m.containers.flatMap(fieldMocks), ...bodyMocks(m.body, queries.mocks)]));
      const parameterCount = parameterCountOf(m.annotations, table);

      const test: TestCase = {
        name: m.name,
        qualifiedName,
        container: containerNames,
        startLine: line(m.node),
        endLine: endLine(m.node),
        bodyHash: shortHash(normaliseText(m.body.text)),
        statementCount: countStatements(m.body),
        assertions,
        markers,
        mocks,
        framework,
      };
      if (parameterCount !== undefined) test.parameterCount = parameterCount;
      if (isParameterised(m.annotations)) test.parameterised = true;
      const catchAlls = collectCatchAlls(m.body);
      if (catchAlls.length) test.catchAlls = catchAlls;
      tests.push(test);

      const timeout = timeoutFrom(m.annotations, table) ?? timeoutFrom(classAnnotations, table);
      const { sleeps, awaits } = sleepsIn(m.body);
      const t: JavaTestTiming = { qualifiedName, sleeps, awaits };
      if (timeout && !Number.isNaN(timeout.ms)) {
        t.timeoutMs = timeout.ms;
        t.timeoutSource = timeout.source;
      } else if (timeout) {
        t.timeoutSource = timeout.source;
      }
      timing.push(t);
    }

    // Top level class markers are file level in Java: they cover every test in the file.
    const fileMarkers: SkipMarker[] = [];
    for (const node of root.namedChildren) {
      if (CONTAINER_TYPES.has(node.type)) fileMarkers.push(...markersFromAnnotations(annotationsOf(node), framework));
    }

    const inventory: TestInventory = {
      path,
      language: 'java',
      framework,
      tests,
      assertionHelpers: helpers,
      imports: imports.map((i) => (i.isStatic ? `static ${i.path}` : i.path)),
      fileMarkers,
      parseErrors: countParseErrors(root),
    };
    return { inventory, timing };
  } finally {
    tree.delete();
  }
}
