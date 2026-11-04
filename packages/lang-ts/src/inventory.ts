/**
 * Builds a TestInventory for a TypeScript or JavaScript test file.
 *
 * The four tree-sitter queries in ../queries collect candidate nodes. This
 * module walks the callee chains of those candidates to decide what each one
 * is (test, container, inline marker, assertion, mock), attributes it to the
 * enclosing test or container, and fills the fields defined in
 * docs/conventions.md.
 */

import { countParseErrors, normaliseText, parseSource, shortHash } from '@testwitness/core';
import type { Assertion, AssertionKind, CallSite, CatchAll, FrameworkProfile, Node, SkipMarker, TestCase, TestInventory } from '@testwitness/core';
import type { Query } from '@testwitness/core';
import { grammarFor, grammarForPath } from './grammar.js';
import type { GrammarId } from './grammar.js';
import {
  CHAI_LANGUAGE_CHAINS,
  CONTAINER_ROOTS,
  MATCHER_LATTICE,
  MODIFIERS,
  NON_DECLARATION_PROPERTIES,
  ROOT_ALIASES,
  detectFramework,
} from './frameworks.js';
import type { MarkerKind } from './frameworks.js';

export const QUALIFIED_NAME_SEPARATOR = ' › ';

const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function', 'method_definition']);

const STATEMENT_TYPES = new Set([
  'expression_statement',
  'lexical_declaration',
  'variable_declaration',
  'return_statement',
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'throw_statement',
  'switch_statement',
  'break_statement',
  'continue_statement',
  'labeled_statement',
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'debugger_statement',
  'with_statement',
  // A statement the parser could not read is still a statement the author wrote. Counting it keeps
  // a test with a syntax error from being reported as emptied.
  'ERROR',
]);

const ASSERTION_ROOTS = new Set(['expect', 'expectTypeOf', 'assertType', 'assert']);

interface Segment {
  name: string;
  /** The `arguments` node (or a template_string for tagged templates) when the segment is called. */
  args?: Node;
}

interface Chain {
  /** Root identifier, `this`, or undefined when the chain starts with something else. */
  root?: Node;
  rootName: string;
  /** Arguments of the root call when the root itself is called (expect(x)). */
  rootArgs?: Node;
  /** Member segments after the root, outermost last. `()` marks a call applied to the previous segment's result. */
  segments: Segment[];
  /** Source text of the object left of `.should` when the chain contains a Chai should. */
  shouldSubject?: string;
}

/** Walk a call or member expression down to its root identifier. */
function unwindChain(expr: Node): Chain | undefined {
  const segments: Segment[] = [];
  let node: Node | null = expr;
  let carried: Node | undefined;
  let shouldSubject: string | undefined;
  while (node) {
    switch (node.type) {
      case 'call_expression': {
        if (carried) segments.unshift({ name: '()', args: carried });
        carried = node.childForFieldName('arguments') ?? undefined;
        node = node.childForFieldName('function');
        break;
      }
      case 'member_expression': {
        const prop = node.childForFieldName('property');
        const obj = node.childForFieldName('object');
        if (!prop || !obj) return undefined;
        const seg: Segment = { name: prop.text };
        if (carried) seg.args = carried;
        segments.unshift(seg);
        carried = undefined;
        if (prop.text === 'should') shouldSubject = squash(unwrapExpression(obj).text);
        node = obj;
        break;
      }
      case 'parenthesized_expression':
      case 'non_null_expression':
      case 'as_expression':
      case 'satisfies_expression':
      case 'type_assertion': {
        node = node.namedChildren[0] ?? null;
        break;
      }
      case 'identifier':
      case 'this': {
        const chain: Chain = { root: node, rootName: node.text, segments };
        if (carried) chain.rootArgs = carried;
        if (shouldSubject !== undefined) chain.shouldSubject = shouldSubject;
        return chain;
      }
      default: {
        const chain: Chain = { rootName: '', segments };
        if (shouldSubject !== undefined) chain.shouldSubject = shouldSubject;
        return chain;
      }
    }
  }
  return undefined;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function line(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

/** Named children of an `arguments` node, comments excluded. */
function argList(args: Node | undefined): Node[] {
  if (!args || args.type !== 'arguments') return [];
  return args.namedChildren.filter((c): c is Node => c !== null && c.type !== 'comment');
}

function isStringLike(node: Node | undefined): boolean {
  return node !== undefined && (node.type === 'string' || node.type === 'template_string');
}

/** Title text: unquoted for plain strings, raw source for template literals and anything dynamic. */
function titleOf(node: Node): string {
  if (node.type === 'string') {
    return node.namedChildren
      .filter((c): c is Node => c !== null && c.type !== 'comment')
      .map((c) => c.text)
      .join('');
  }
  return node.text;
}

function stringValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'string') return titleOf(node);
  if (node.type === 'template_string' && !node.text.includes('${')) return node.text.slice(1, -1);
  return undefined;
}

function isFunctionNode(node: Node): boolean {
  return FUNCTION_TYPES.has(node.type);
}

/** Unwrap await, parentheses and TS wrappers around an expression. */
function unwrapExpression(node: Node): Node {
  let n = node;
  for (;;) {
    if (
      n.type === 'await_expression' ||
      n.type === 'parenthesized_expression' ||
      n.type === 'non_null_expression' ||
      n.type === 'as_expression' ||
      n.type === 'satisfies_expression'
    ) {
      const inner = n.namedChildren.find((c): c is Node => c !== null && c.type !== 'comment');
      if (!inner) return n;
      n = inner;
      continue;
    }
    return n;
  }
}

interface Declaration {
  node: Node;
  base: 'test' | 'container';
  title: string;
  /** The callback or referenced function; undefined for todo and pending declarations. */
  body?: Node;
  markers: SkipMarker[];
  parameterCount?: number;
  /** True for test.each, it.each, describe.each and test.for declarations, countable or not. */
  parameterised?: boolean;
}

/** Count rows of a test.each table: array literal elements or tagged template data rows. */
function countTable(args: Node | undefined): number | undefined {
  if (!args) return undefined;
  if (args.type === 'template_string') {
    const rows = args.text
      .slice(1, -1)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return rows.length > 0 ? rows.length - 1 : 0;
  }
  const first = argList(args)[0];
  if (first && first.type === 'array') {
    const items = first.namedChildren.filter((c): c is Node => c !== null && c.type !== 'comment');
    if (items.some((i) => i.type === 'spread_element')) return undefined;
    return items.length;
  }
  return undefined;
}

function markerFor(name: string, kind: MarkerKind, at: Node, extra: Partial<SkipMarker> = {}): SkipMarker {
  const m: SkipMarker = { marker: name, kind, line: line(at) };
  if (extra.reason !== undefined) m.reason = extra.reason;
  if (extra.constant !== undefined) m.constant = extra.constant;
  return m;
}

/** Decide whether a matched call is a test or container declaration. */
function analyseDeclaration(call: Node): Declaration | undefined {
  const chain = unwindChain(call);
  if (!chain || !chain.root || chain.root.type !== 'identifier') return undefined;
  const alias = ROOT_ALIASES[chain.rootName];
  if (!alias) return undefined;

  let base = alias.base;
  const markers: SkipMarker[] = [];
  let parameterCount: number | undefined;
  let parameterised = false;
  const prefix: string[] = [chain.rootName];

  if (alias.marker) markers.push(markerFor(chain.rootName, alias.marker, call, { constant: true }));

  for (const seg of chain.segments) {
    if (seg.name === '()') continue;
    if (NON_DECLARATION_PROPERTIES.has(seg.name)) return undefined;
    if (CONTAINER_ROOTS.includes(seg.name)) {
      base = 'container';
      prefix.push(seg.name);
      continue;
    }
    const mod = MODIFIERS[seg.name];
    if (!mod) return undefined;
    prefix.push(seg.name);
    if (mod.table) {
      parameterCount = countTable(seg.args);
      parameterised = true;
      continue;
    }
    if (mod.marker) {
      const name = prefix.join('.');
      if (mod.conditional && seg.args) {
        const cond = argList(seg.args)[0];
        // skipIf(false) and runIf(true) fold to "runs": no marker at all, per the conventions.
        const foldsToRun =
          cond !== undefined &&
          ((mod.conditional === 'skipIf' && cond.type === 'false') || (mod.conditional === 'runIf' && cond.type === 'true'));
        if (foldsToRun) continue;
        const constant =
          cond !== undefined &&
          ((mod.conditional === 'skipIf' && cond.type === 'true') || (mod.conditional === 'runIf' && cond.type === 'false'));
        markers.push(markerFor(name, mod.marker, call, { constant }));
      } else {
        markers.push(markerFor(name, mod.marker, call, { constant: true }));
      }
    }
  }

  // Declaration arguments: the last called segment, or the root call.
  const last = chain.segments[chain.segments.length - 1];
  const declArgs = last ? last.args : chain.rootArgs;
  const args = argList(declArgs);
  const titleNode = args[0];
  if (!titleNode || !isStringLike(titleNode)) return undefined;

  const decl: Declaration = { node: call, base, title: titleOf(titleNode), markers };
  if (parameterCount !== undefined) decl.parameterCount = parameterCount;
  if (parameterised) decl.parameterised = true;

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (isFunctionNode(a)) {
      decl.body = a;
      break;
    }
    if (a.type === 'object') {
      readOptionMarkers(a, prefix.join('.'), markers);
      continue;
    }
    if (a.type === 'identifier' || a.type === 'member_expression') {
      decl.body = a;
      break;
    }
  }

  if (!decl.body && base === 'test' && !markers.some((m) => m.kind === 'todo')) {
    // Mocha pending test: it('title') with no callback.
    markers.push(markerFor(`${prefix.join('.')} (pending)`, 'todo', call, { constant: true }));
  }
  return decl;
}

/** Vitest and Playwright option objects: test('title', { skip: true, only: true, todo: true, fails: true }, fn). */
function readOptionMarkers(obj: Node, prefix: string, markers: SkipMarker[]): void {
  for (const pair of obj.namedChildren) {
    if (!pair || pair.type !== 'pair') continue;
    const key = pair.childForFieldName('key');
    const value = pair.childForFieldName('value');
    if (!key || !value) continue;
    const mod = MODIFIERS[key.text];
    if (!mod?.marker || mod.conditional) continue;
    if (value.type === 'true') {
      markers.push(markerFor(`${prefix} { ${key.text} }`, mod.marker, pair, { constant: true }));
    } else if (value.type === 'string') {
      markers.push(markerFor(`${prefix} { ${key.text} }`, mod.marker, pair, { constant: true, reason: titleOf(value) }));
    } else if (value.type !== 'false') {
      markers.push(markerFor(`${prefix} { ${key.text} }`, 'conditional-skip', pair, { constant: false }));
    }
  }
}

/** Is the matched call the inner `test.each(table)` of `test.each(table)('title', fn)`? */
function isInnerCall(call: Node): boolean {
  const parent = call.parent;
  return parent !== null && parent.type === 'call_expression' && parent.childForFieldName('function')?.id === call.id;
}

/** Count executable statements under a body node, per docs/conventions.md. */
export function countStatements(body: Node | undefined): number {
  if (!body) return 0;
  if (isFunctionNode(body)) {
    const inner = body.childForFieldName('body');
    if (!inner) return 0;
    if (inner.type !== 'statement_block') return isCountableExpression(inner) ? 1 : 0;
    return countIn(inner);
  }
  if (body.type === 'statement_block') return countIn(body);
  // A referenced function: one call we cannot see into.
  return 1;
}

/** Every call in a test body (callbacks included), in source order; `statement` marks a call that is a whole expression statement, possibly awaited. */
export function collectCalls(body: Node | undefined): CallSite[] {
  if (!body || !isFunctionNode(body)) return [];
  const inner = body.childForFieldName('body');
  if (!inner) return [];
  const out: CallSite[] = [];
  const record = (call: Node): void => {
    const fn = call.childForFieldName('function');
    if (!fn) return;
    const callee = fn.text.replace(/\s+/g, '');
    const f = unwrapExpression(fn);
    const name = f.type === 'member_expression' ? (f.childForFieldName('property')?.text ?? callee) : callee;
    let up = call.parent;
    while (up && (up.type === 'await_expression' || up.type === 'parenthesized_expression' || up.type === 'non_null_expression')) up = up.parent;
    // An expression bodied arrow (`() => client.flush()`) is a single statement.
    const statement = up !== null && (up.type === 'expression_statement' || up.id === body.id);
    out.push({ callee, name, line: line(call), statement });
  };
  const visit = (node: Node): void => {
    if (node.type === 'call_expression') record(node);
    for (const child of node.namedChildren) if (child) visit(child);
  };
  visit(inner);
  return out;
}

function isCountableExpression(expr: Node): boolean {
  const e = unwrapExpression(expr);
  return e.type !== 'string' && e.type !== 'template_string' && e.type !== 'comment';
}

function countIn(node: Node): number {
  let n = 0;
  const stack: Node[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of cur.namedChildren) {
      if (!child) continue;
      if (STATEMENT_TYPES.has(child.type) && isCountableStatement(child)) n++;
      stack.push(child);
    }
  }
  return n;
}

function isCountableStatement(stmt: Node): boolean {
  if (stmt.type === 'ERROR') return stmt.text.trim().length > 0;
  if (stmt.type === 'expression_statement') {
    const expr = stmt.namedChildren.find((c): c is Node => c !== null && c.type !== 'comment');
    return expr !== undefined && isCountableExpression(expr);
  }
  if (stmt.type === 'return_statement') {
    return stmt.namedChildren.some((c) => c !== null && c.type !== 'comment');
  }
  return true;
}

interface AssertionAnalysis {
  callee: string;
  subject?: string;
  expected?: string;
  kind: AssertionKind;
  family?: string;
  strength?: number;
}

/** Analyse an expression as an assertion chain. Returns undefined when it is not one. */
function analyseAssertion(expr: Node, helpers: Set<string>): AssertionAnalysis | undefined {
  const e = unwrapExpression(expr);
  if (e.type !== 'call_expression' && e.type !== 'member_expression') return undefined;
  const chain = unwindChain(e);
  if (!chain) return undefined;

  // Chai should style: value.should.equal(x), value.should.be.true
  if (chain.shouldSubject !== undefined) {
    const idx = chain.segments.findIndex((s) => s.name === 'should');
    const rest = chain.segments.slice(idx + 1).filter((s) => s.name !== '()');
    if (rest.length === 0) return undefined;
    const terminal = rest[rest.length - 1]!;
    if (CHAI_LANGUAGE_CHAINS.has(terminal.name)) return undefined;
    const callee = ['should', ...rest.map((s) => s.name)].join('.');
    return withLattice(callee, chain.shouldSubject, rest, terminal);
  }

  if (!chain.root) return namedCustomAssertion(chain);
  let rootName = chain.rootName;
  let segments = chain.segments;
  let rootArgs = chain.rootArgs;

  // chai.expect(x)..., chai.assert.equal(...), sinon.assert.calledWith(...)
  if ((rootName === 'chai' || rootName === 'sinon') && segments[0] && (segments[0].name === 'expect' || segments[0].name === 'assert')) {
    const first = segments[0];
    rootName = rootName === 'sinon' ? 'sinon.assert' : first.name;
    rootArgs = first.args;
    segments = segments.slice(1);
  }

  if (rootName === 'expect' || rootName === 'expectTypeOf' || rootName === 'assertType') {
    const named = segments.filter((s) => s.name !== '()');
    if (named.length === 0) return undefined;
    const terminal = named[named.length - 1]!;
    if (CHAI_LANGUAGE_CHAINS.has(terminal.name)) return undefined;
    if (terminal.name === 'extend' || terminal.name === 'configure' || terminal.name === 'addSnapshotSerializer') return undefined;
    let subject: string | undefined;
    const rootArgList = argList(rootArgs);
    if (rootArgList[0]) subject = squash(rootArgList[0].text);
    else {
      const soft = named.find((s) => (s.name === 'soft' || s.name === 'poll') && s.args);
      const softArg = argList(soft?.args)[0];
      if (softArg) subject = squash(softArg.text);
    }
    const callee = [rootName, ...named.map((s) => s.name)].join('.');
    return withLattice(callee, subject, named, terminal);
  }

  if (rootName === 'assert' || rootName === 'sinon.assert') {
    const named = segments.filter((s) => s.name !== '()');
    if (named.length === 0) {
      const arg = argList(rootArgs)[0];
      const base: AssertionAnalysis = { callee: 'assert', kind: 'smoke', family: 'value', strength: 1 };
      if (arg) base.subject = squash(arg.text);
      return base;
    }
    const terminal = named[named.length - 1]!;
    if (!terminal.args) return undefined;
    const arg = argList(terminal.args)[0];
    const subject = arg ? squash(arg.text) : undefined;
    const callee = [rootName, ...named.map((s) => s.name)].join('.');
    return withLattice(callee, subject, named, terminal, 1);
  }

  if (segments.length === 0 && chain.root.type === 'identifier' && helpers.has(rootName) && rootArgs) {
    const arg = argList(rootArgs)[0];
    const out: AssertionAnalysis = { callee: rootName, kind: 'custom' };
    if (arg) out.subject = squash(arg.text);
    return out;
  }
  return namedCustomAssertion(chain);
}

const CUSTOM_ASSERTION_NAME = /^(assert|check|verify|expect|should|validate)/;

/** Bare framework roots are never custom assertions on their own: `expect(x)` alone asserts nothing. */
const CUSTOM_ASSERTION_EXCLUDED = new Set(['expect', 'should', 'assert', 'expectTypeOf', 'assertType']);

/**
 * Name based custom assertion: a call whose callee name (the last member) starts with assert,
 * check, verify, expect, should or validate, bare or on any receiver. The spec follows helpers one
 * file deep; the naming convention is the cheap proxy for helpers imported from elsewhere.
 */
function namedCustomAssertion(chain: Chain): AssertionAnalysis | undefined {
  const named = chain.segments.filter((s) => s.name !== '()');
  const last = named[named.length - 1];
  let name: string;
  let args: Node | undefined;
  if (last) {
    name = last.name;
    args = last.args;
  } else {
    if (!chain.root || chain.root.type !== 'identifier') return undefined;
    name = chain.rootName;
    args = chain.rootArgs;
  }
  if (!args || args.type !== 'arguments') return undefined;
  if (!CUSTOM_ASSERTION_NAME.test(name) || CUSTOM_ASSERTION_EXCLUDED.has(name)) return undefined;
  // page.check(selector) and locator.check() are Playwright actions, not assertions.
  if (last && name === 'check') return undefined;
  const out: AssertionAnalysis = { callee: name, kind: 'custom' };
  const arg = argList(args)[0];
  if (arg) out.subject = squash(arg.text);
  return out;
}

const NULLISH_MATCHERS = new Set(['toBeNull', 'toBeUndefined', 'toBeNaN', 'null', 'undefined', 'NaN', 'isNull', 'isUndefined', 'isNaN']);

function withLattice(callee: string, subject: string | undefined, named: Segment[], terminal: Segment, expectedIndex = 0): AssertionAnalysis {
  const out: AssertionAnalysis = { callee, kind: 'value' };
  if (subject !== undefined) out.subject = subject;
  const entry = MATCHER_LATTICE[terminal.name];
  const negated = named.some((s) => s.name === 'not');
  const termArgs = argList(terminal.args);
  const expectedNode = termArgs[expectedIndex];
  if (expectedNode && (!entry || entry.family !== 'count')) out.expected = squash(expectedNode.text);
  if (!entry) return out;
  out.kind = entry.kind;
  out.family = entry.family;
  out.strength = entry.strength;
  if (entry.family === 'exception') {
    const narrowing = callee.startsWith('assert') || callee.startsWith('sinon') ? termArgs.length >= 2 : termArgs.length >= 1;
    if (entry.kind === 'exception' && narrowing) out.strength = 2;
    if (negated) {
      out.kind = 'smoke';
      out.strength = 0;
    }
  } else if (negated && entry.family === 'value') {
    if (entry.strength > 1) out.strength = 1;
    if (NULLISH_MATCHERS.has(terminal.name) || entry.kind === 'smoke') out.kind = 'smoke';
  }
  return out;
}

interface Scope {
  kind: 'test' | 'container' | 'file';
  decl?: Declaration;
}

type NodeId = number;

export interface InventoryOptions {
  grammar?: GrammarId;
}

export async function buildInventory(path: string, source: string, profile: FrameworkProfile, options: InventoryOptions = {}): Promise<TestInventory> {
  const grammarId = options.grammar ?? grammarForPath(path);
  const { language, queries } = await grammarFor(grammarId);
  const tree = parseSource(language, source);
  const root = tree.rootNode;
  const languageId = grammarId === 'javascript' ? 'javascript' : 'typescript';

  const imports = collectImports(root);
  const framework = detectFramework(imports, source, profile.frameworks);

  // 1. Declarations.
  const tests = new Map<NodeId, Declaration>();
  const containers = new Map<NodeId, Declaration>();
  const scopeOf = (node: Node): Scope => {
    let cur: Node | null = node.parent;
    while (cur) {
      if (cur.type === 'call_expression') {
        const t = tests.get(cur.id);
        if (t) return { kind: 'test', decl: t };
        const c = containers.get(cur.id);
        if (c) return { kind: 'container', decl: c };
      }
      cur = cur.parent;
    }
    return { kind: 'file' };
  };

  for (const call of capturedNodes(queries.tests, root, 'call')) {
    if (isInnerCall(call)) continue;
    if (tests.has(call.id) || containers.has(call.id)) continue;
    const decl = analyseDeclaration(call);
    if (!decl) continue;
    // A test declared inside another test body is not a declaration in any framework;
    // Playwright's inline test.skip('reason') lands here and is read as a marker instead.
    if (decl.base === 'test' && scopeOf(call).kind === 'test') continue;
    (decl.base === 'test' ? tests : containers).set(call.id, decl);
  }

  // 2. Assertion helpers: named functions outside tests whose body asserts.
  const assertionHelpers = new Set<string>();
  const extra = new Set(profile.extraAssertions);
  const candidates = assertionCandidates(queries.assertions, root);
  for (const { stmt, expr } of candidates) {
    const scope = scopeOf(stmt);
    if (scope.kind === 'test') continue;
    if (!analyseAssertion(expr, extra)) continue;
    const name = enclosingFunctionName(stmt, containers);
    if (name && !looksLikeTestName(name)) assertionHelpers.add(name);
  }
  const helperNames = new Set([...assertionHelpers, ...extra]);

  // 3. Assertions attributed to tests.
  const testAssertions = new Map<NodeId, Assertion[]>();
  for (const { stmt, expr } of candidates) {
    const scope = scopeOf(stmt);
    if (scope.kind !== 'test' || !scope.decl) continue;
    const analysis = analyseAssertion(expr, helperNames);
    if (!analysis) continue;
    const a: Assertion = {
      callee: analysis.callee,
      text: squash(stmt.type === 'arrow_function' ? expr.text : stmt.text),
      line: line(expr),
      kind: analysis.kind,
    };
    if (analysis.subject !== undefined) a.subject = analysis.subject;
    if (analysis.expected !== undefined) a.expected = analysis.expected;
    if (analysis.family !== undefined) a.family = analysis.family;
    if (analysis.strength !== undefined) a.strength = analysis.strength;
    push(testAssertions, scope.decl.node.id, a);
  }

  // 4. Inline markers.
  const fileMarkers: SkipMarker[] = [];
  const containerMarkers = new Map<NodeId, SkipMarker[]>();
  const testMarkers = new Map<NodeId, SkipMarker[]>();
  for (const call of capturedNodes(queries.markers, root, 'call')) {
    const marker = analyseInlineMarker(call, tests, containers);
    if (!marker) continue;
    const scope = scopeOf(call);
    if (scope.kind === 'test' && scope.decl) push(testMarkers, scope.decl.node.id, marker);
    else if (scope.kind === 'container' && scope.decl) push(containerMarkers, scope.decl.node.id, marker);
    else fileMarkers.push(marker);
  }

  // 5. Mocks.
  const fileMocks: string[] = [];
  const containerMocks = new Map<NodeId, string[]>();
  const testMocks = new Map<NodeId, string[]>();
  for (const call of capturedNodes(queries.mocks, root, 'call')) {
    const target = mockTarget(call);
    if (!target) continue;
    const scope = scopeOf(call);
    if (scope.kind === 'test' && scope.decl) push(testMocks, scope.decl.node.id, target);
    else if (scope.kind === 'container' && scope.decl) push(containerMocks, scope.decl.node.id, target);
    else fileMocks.push(target);
  }

  // 6. Assemble test cases.
  const cases: TestCase[] = [];
  for (const decl of tests.values()) {
    const ancestors = containerAncestors(decl.node, containers);
    const containerTitles = ancestors.map((c) => c.title);
    const markers: SkipMarker[] = [...fileMarkers];
    const mocks = new Set<string>(fileMocks);
    let parameterCount = decl.parameterCount;
    let parameterised = decl.parameterised === true || isDeclaredInLoop(decl.node, containers);
    for (const c of ancestors) {
      markers.push(...c.markers, ...(containerMarkers.get(c.node.id) ?? []));
      for (const m of containerMocks.get(c.node.id) ?? []) mocks.add(m);
      if (c.parameterCount !== undefined) parameterCount = parameterCount === undefined ? c.parameterCount : parameterCount * c.parameterCount;
      if (c.parameterised) parameterised = true;
    }
    markers.push(...decl.markers, ...(testMarkers.get(decl.node.id) ?? []));
    for (const m of testMocks.get(decl.node.id) ?? []) mocks.add(m);

    const bodyText = bodyTextOf(decl.body);
    const tc: TestCase = {
      name: decl.title,
      qualifiedName: [...containerTitles, decl.title].join(QUALIFIED_NAME_SEPARATOR),
      container: containerTitles,
      startLine: line(decl.node),
      endLine: endLine(decl.node),
      bodyHash: shortHash(normaliseText(bodyText)),
      statementCount: countStatements(decl.body),
      assertions: (testAssertions.get(decl.node.id) ?? []).sort((a, b) => a.line - b.line),
      markers,
      mocks: [...mocks],
      calls: collectCalls(decl.body),
      framework,
    };
    if (parameterCount !== undefined) tc.parameterCount = parameterCount;
    if (parameterised) tc.parameterised = true;
    const catchAlls = collectCatchAlls(decl.body);
    if (catchAlls.length > 0) tc.catchAlls = catchAlls;
    cases.push(tc);
  }
  cases.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName));

  const inventory: TestInventory = {
    path,
    language: languageId,
    framework,
    tests: cases,
    assertionHelpers,
    imports,
    fileMarkers,
    parseErrors: countParseErrors(root),
  };
  tree.delete();
  return inventory;
}

/** Text hashed for bodyHash: the function body alone, so arrow and function forms with the same body hash the same. */
function bodyTextOf(body: Node | undefined): string {
  if (!body) return '';
  if (isFunctionNode(body)) return body.childForFieldName('body')?.text ?? body.text;
  return body.text;
}

function push<T>(map: Map<NodeId, T[]>, key: NodeId, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function capturedNodes(query: Query, root: Node, name: string): Node[] {
  const out: Node[] = [];
  const seen = new Set<NodeId>();
  for (const match of query.matches(root)) {
    for (const cap of match.captures) {
      if (cap.name !== name) continue;
      if (seen.has(cap.node.id)) continue;
      seen.add(cap.node.id);
      out.push(cap.node);
    }
  }
  return out;
}

interface Candidate {
  stmt: Node;
  expr: Node;
}

function assertionCandidates(query: Query, root: Node): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<NodeId>();
  for (const match of query.matches(root)) {
    let stmt: Node | undefined;
    let expr: Node | undefined;
    for (const cap of match.captures) {
      if (cap.name === 'stmt') stmt = cap.node;
      else if (cap.name === 'expr') expr = cap.node;
    }
    if (!stmt || !expr || expr.type === 'comment') continue;
    if (stmt.type === 'arrow_function') {
      if (expr.type === 'statement_block') continue;
      if (expr.id !== stmt.childForFieldName('body')?.id) continue;
      if (isCallbackOfAssertion(stmt)) continue;
    }
    if (seen.has(expr.id)) continue;
    seen.add(expr.id);
    out.push({ stmt, expr });
  }
  return out;
}

/** `expect(() => f()).toThrow()`: the arrow body `f()` is not an assertion of its own. */
function isCallbackOfAssertion(arrow: Node): boolean {
  const args = arrow.parent;
  if (!args || args.type !== 'arguments') return false;
  const call = args.parent;
  if (!call || call.type !== 'call_expression') return false;
  // Climb to the outermost chain expression so expect(() => ...).rejects.toThrow() is seen as a whole.
  let top: Node = call;
  while (top.parent && (top.parent.type === 'member_expression' || top.parent.type === 'call_expression')) top = top.parent;
  const chain = unwindChain(top);
  if (!chain) return false;
  if (chain.shouldSubject !== undefined) return true;
  return ASSERTION_ROOTS.has(chain.rootName) || chain.rootName === 'chai' || chain.rootName === 'sinon';
}

/** Resolve the name of the nearest enclosing named function that is not a test or container callback. */
function enclosingFunctionName(node: Node, containers: Map<NodeId, Declaration>): string | undefined {
  let cur: Node | null = node;
  while (cur) {
    if (isFunctionNode(cur) || cur.type === 'function_declaration' || cur.type === 'generator_function_declaration') {
      const parent = cur.parent;
      if (parent && parent.type === 'arguments') {
        const call = parent.parent;
        if (call && containers.has(call.id)) return undefined;
        // Anonymous callback passed to something else (forEach, beforeEach): keep climbing.
      } else {
        const name = functionName(cur);
        if (name) return name;
      }
    }
    cur = cur.parent;
  }
  return undefined;
}

function functionName(fn: Node): string | undefined {
  if (fn.type === 'function_declaration' || fn.type === 'generator_function_declaration' || fn.type === 'method_definition') {
    return fn.childForFieldName('name')?.text;
  }
  const own = fn.childForFieldName('name');
  if (own) return own.text;
  const parent = fn.parent;
  if (!parent) return undefined;
  if (parent.type === 'variable_declarator') return parent.childForFieldName('name')?.text;
  if (parent.type === 'pair') return parent.childForFieldName('key')?.text;
  if (parent.type === 'assignment_expression') return parent.childForFieldName('left')?.text;
  if (parent.type === 'public_field_definition' || parent.type === 'field_definition') return parent.childForFieldName('name')?.text;
  return undefined;
}

export function looksLikeTestName(name: string): boolean {
  return /^(test|it|spec|specify)([A-Z_0-9]|$)/.test(name) || /^x?(it|test)$/.test(name);
}

/**
 * A test declared inside a `for` loop (Playwright's documented way to run one test per
 * array element) is parameterised with an unknown count.
 */
function isDeclaredInLoop(node: Node, containers: Map<NodeId, Declaration>): boolean {
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === 'for_statement' || cur.type === 'for_in_statement') return true;
    if (cur.type === 'call_expression' && containers.has(cur.id)) return false;
    cur = cur.parent;
  }
  return false;
}

/** A function node is immediately invoked: `(() => { ... })()` or `(async function () { ... })()`. */
function isImmediatelyInvoked(fn: Node): boolean {
  let cur: Node = fn;
  while (cur.parent && cur.parent.type === 'parenthesized_expression') cur = cur.parent;
  const parent = cur.parent;
  return parent !== null && parent.type === 'call_expression' && parent.childForFieldName('function')?.id === cur.id;
}

const CATCH_HANDLES = /\b(throw|expect\s*[(.]|assert|fail\s*\(|done\s*\(\s*[^)\s]|reject\s*\(|Promise\.reject)/;

/** Handler identifiers passed to `.catch(name)` that fail the test rather than swallow. */
const CATCH_HANDLER_FAILS = /^(done|fail|reject|expect|assert|throw)/i;

function firstStatementSnippet(block: Node | null | undefined, fallback: Node): string {
  const first = block?.namedChildren.find((c): c is Node => c !== null && c.type !== 'comment');
  return normaliseText(first?.text ?? fallback.text).slice(0, 120);
}

/**
 * Catch clauses and `.catch(fn)` handlers in the test body that swallow a failure (E001).
 * Nested functions are not entered unless immediately invoked; JavaScript catches everything,
 * so every catch clause qualifies and the binding is its parameter name or `any`.
 */
export function collectCatchAlls(body: Node | undefined): CatchAll[] {
  const out: CatchAll[] = [];
  if (!body) return out;
  const start = isFunctionNode(body) ? (body.childForFieldName('body') ?? body) : body;
  const stack: Node[] = [start];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id !== start.id && isFunctionNode(node) && !isImmediatelyInvoked(node)) continue;
    if (node.type === 'try_statement') {
      const snippet = firstStatementSnippet(node.childForFieldName('body'), node);
      for (const clause of node.namedChildren) {
        if (!clause || clause.type !== 'catch_clause') continue;
        const param = clause.childForFieldName('parameter');
        const binding = param ? squash(param.text) : 'any';
        const text = clause.childForFieldName('body')?.text ?? '';
        out.push({ line: line(clause), binding, swallows: !CATCH_HANDLES.test(text), snippet });
      }
    } else if (node.type === 'call_expression') {
      const handler = promiseCatchHandler(node);
      if (handler) out.push(handler);
    }
    for (let i = node.namedChildren.length - 1; i >= 0; i--) {
      const c = node.namedChildren[i];
      if (c) stack.push(c);
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** `promise.catch(() => {})` or `.catch(noop)`: a swallowing handler on the promise left of `.catch`. */
function promiseCatchHandler(call: Node): CatchAll | undefined {
  const fn = call.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return undefined;
  const prop = fn.childForFieldName('property');
  const obj = fn.childForFieldName('object');
  if (!prop || !obj || prop.text !== 'catch') return undefined;
  const args = argList(call.childForFieldName('arguments') ?? undefined);
  const handler = args[0];
  if (!handler) return undefined;
  let swallows: boolean;
  if (isFunctionNode(handler)) {
    const inner = handler.childForFieldName('body');
    swallows = !CATCH_HANDLES.test(inner?.text ?? '');
  } else if (handler.type === 'identifier') {
    swallows = !CATCH_HANDLER_FAILS.test(handler.text);
  } else {
    return undefined;
  }
  return { line: line(prop), binding: 'promise catch', swallows, snippet: normaliseText(obj.text).slice(0, 120) };
}

function containerAncestors(node: Node, containers: Map<NodeId, Declaration>): Declaration[] {
  const out: Declaration[] = [];
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === 'call_expression') {
      const c = containers.get(cur.id);
      if (c) out.unshift(c);
    }
    cur = cur.parent;
  }
  return out;
}

/** Playwright test.skip()/test.fixme()/test.fail() and Mocha this.skip() inside a body. */
function analyseInlineMarker(call: Node, tests: Map<NodeId, Declaration>, containers: Map<NodeId, Declaration>): SkipMarker | undefined {
  if (tests.has(call.id) || containers.has(call.id)) return undefined;
  const chain = unwindChain(call);
  if (!chain || !chain.root) return undefined;
  const seg = chain.segments[0];
  if (!seg || chain.segments.length !== 1) return undefined;
  const args = argList(seg.args);

  if (chain.root.type === 'this') {
    if (seg.name !== 'skip') return undefined;
    const conditional = isUnderCondition(call);
    return markerFor('this.skip', conditional ? 'conditional-skip' : 'skip', call, { constant: !conditional });
  }

  // A declaration shape (title first) is handled by tests.scm, never here.
  if (args[0] && isStringLike(args[0]) && args[1] && (isFunctionNode(args[1]) || args[1].type === 'object')) {
    return undefined;
  }
  const kindByProp: Record<string, MarkerKind> = { skip: 'skip', fixme: 'fixme', fail: 'xfail' };
  const kind = kindByProp[seg.name];
  if (!kind) return undefined;
  const name = `${chain.rootName}.${seg.name}`;
  const cond = args[0];
  const reasonNode = args.find((a, i) => i > 0 && isStringLike(a)) ?? (cond && isStringLike(cond) ? cond : undefined);
  const reason = stringValue(reasonNode);
  const extra: Partial<SkipMarker> = {};
  if (reason !== undefined) extra.reason = reason;
  if (!cond || isStringLike(cond)) {
    // `if (browserName === 'webkit') test.fail();` is a conditional marker, like Mocha's this.skip() under an if.
    if (isUnderCondition(call)) {
      extra.constant = false;
      return markerFor(name, kind === 'skip' ? 'conditional-skip' : kind, call, extra);
    }
    extra.constant = true;
    return markerFor(name, kind, call, extra);
  }
  // Conditional form: test.skip(cond, reason), test.fixme(({ browserName }) => ..., reason)
  extra.constant = cond.type === 'true';
  return markerFor(name, kind === 'skip' ? 'conditional-skip' : kind, call, extra);
}

function isUnderCondition(node: Node): boolean {
  let cur: Node | null = node.parent;
  while (cur) {
    if (isFunctionNode(cur)) return false;
    if (
      cur.type === 'if_statement' ||
      cur.type === 'ternary_expression' ||
      cur.type === 'switch_statement' ||
      cur.type === 'binary_expression' ||
      cur.type === 'for_statement' ||
      cur.type === 'while_statement'
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** Normalised mock target for jest.mock, vi.spyOn, sinon.stub and friends. */
function mockTarget(call: Node): string | undefined {
  const chain = unwindChain(call);
  if (!chain || chain.segments.length !== 1) return undefined;
  const seg = chain.segments[0]!;
  const args = argList(seg.args);
  switch (seg.name) {
    case 'mock':
    case 'doMock':
    case 'unstable_mockModule':
    case 'createSpyObj': {
      if (chain.rootName === 'sinon') return args[0] ? squash(args[0].text) : undefined;
      return stringValue(args[0]) ?? (args[0] ? squash(args[0].text) : undefined);
    }
    case 'replace':
    case 'replaceGetter':
    case 'replaceSetter':
    case 'spyOn':
    case 'stub':
    case 'spy':
    case 'createStubInstance': {
      if (args.length === 0) return undefined;
      const obj = args[0]!;
      if (chain.rootName === 'td' && seg.name === 'replace') return stringValue(obj) ?? squash(obj.text);
      const member = args[1];
      const prop = stringValue(member);
      if (prop !== undefined) return `${squash(obj.text)}.${prop}`;
      if (member) return `${squash(obj.text)}.${squash(member.text)}`;
      return squash(obj.text);
    }
    default:
      return undefined;
  }
}

/** Import sources and require() targets, in file order. */
function collectImports(root: Node): string[] {
  const out: string[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of cur.namedChildren) {
      if (!child) continue;
      if (child.type === 'import_statement') {
        const src = child.childForFieldName('source');
        const v = stringValue(src ?? undefined);
        if (v !== undefined) out.push(v);
        continue;
      }
      if (child.type === 'call_expression') {
        const fn = child.childForFieldName('function');
        if (fn && (fn.text === 'require' || fn.text === 'import' || fn.text === 'await import')) {
          const v = stringValue(argList(child.childForFieldName('arguments') ?? undefined)[0]);
          if (v !== undefined) out.push(v);
        }
      }
      if (child.type === 'export_statement') {
        const src = child.childForFieldName('source');
        const v = stringValue(src ?? undefined);
        if (v !== undefined) out.push(v);
      }
      stack.push(child);
    }
  }
  return out;
}
