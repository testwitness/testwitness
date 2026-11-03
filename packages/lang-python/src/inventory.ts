/**
 * Builds a TestInventory for a Python test file (pytest or unittest).
 *
 * The tree-sitter queries in ../queries find the candidate nodes; this module
 * applies the collection, marker, assertion, mock and counting rules from
 * docs/conventions.md and the spec (sections 1.1, 1.2, 1.6, 1.7).
 */

import { countParseErrors, normaliseText, shortHash } from '@testwitness/core';
import type {
  Assertion,
  AssertionKind,
  FrameworkProfile,
  Node,
  Query,
  SkipMarker,
  TestCase,
  TestInventory,
  CatchAll,
} from '@testwitness/core';
import { parsePython } from './grammar.js';
import {
  MOCK_ASSERTION_METHODS,
  PYTEST_EXCEPTION_CALLS,
  UNITTEST_ASSERTIONS,
  latticeFor,
  parametrizeCaseCount,
} from './frameworks.js';
import type { PythonFramework } from './frameworks.js';

const TEST_NAME = /^test/;
const TEST_CLASS_NAME = /^Test/;
const TEST_CASE_BASE = /(^|\.)(TestCase|IsolatedAsyncioTestCase|AsyncTestCase)$|TestCase$/;
const LITERAL_TYPES = new Set([
  'string',
  'concatenated_string',
  'integer',
  'float',
  'true',
  'false',
  'none',
  'list',
  'tuple',
  'dictionary',
  'set',
]);
const MOCK_STATE_ATTR = /\.(called|call_count|call_args|call_args_list|mock_calls|method_calls|await_count|awaited|await_args|await_args_list)$/;
const MOCK_RECEIVERS = new Set(['mock', 'mocker', 'unittest.mock', 'mocks', 'mock.mock']);

interface FileContext {
  aliases: Map<string, string>;
  helpers: Set<string>;
  framework: PythonFramework;
  /** Parameter names of the current test that are bound to literal parametrize values. */
  literalParams?: Set<string>;
}

// ---------------------------------------------------------------------------
// Node helpers

function line(node: Node): number {
  return node.startPosition.row + 1;
}

function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

/** Named children that are statements (comments are skipped). */
function statements(block: Node | null | undefined): Node[] {
  if (!block) return [];
  return block.namedChildren.filter((c) => c.type !== 'comment');
}

function isDocstring(stmt: Node): boolean {
  if (stmt.type !== 'expression_statement' || stmt.namedChildCount !== 1) return false;
  const t = stmt.namedChildren[0]?.type;
  return t === 'string' || t === 'concatenated_string';
}

function isBareReturn(stmt: Node): boolean {
  return stmt.type === 'return_statement' && stmt.namedChildCount === 0;
}

function unwrap(node: Node): Node {
  let n = node;
  for (;;) {
    if (n.type === 'parenthesized_expression' && n.namedChildCount === 1) {
      n = n.namedChildren[0]!;
      continue;
    }
    if (n.type === 'await' && n.namedChildCount === 1) {
      n = n.namedChildren[0]!;
      continue;
    }
    if (n.type === 'as_pattern') {
      n = n.namedChildren[0]!;
      continue;
    }
    return n;
  }
}

/** The literal value of a string node, without quotes or prefix. */
function stringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const n = unwrap(node);
  if (n.type === 'string') {
    return n.namedChildren
      .filter((c) => c.type === 'string_content' || c.type === 'escape_sequence')
      .map((c) => c.text)
      .join('');
  }
  if (n.type === 'concatenated_string') {
    return n.namedChildren.map((c) => stringValue(c) ?? '').join('');
  }
  return undefined;
}

/** Dotted text of a callee: identifier or attribute chain, else raw text. */
function chainText(node: Node): string {
  const n = unwrap(node);
  if (n.type === 'identifier') return n.text;
  if (n.type === 'attribute') {
    const obj = n.childForFieldName('object');
    const attr = n.childForFieldName('attribute');
    if (obj && attr) return `${chainText(obj)}.${attr.text}`;
  }
  if (n.type === 'call') {
    const fn = n.childForFieldName('function');
    if (fn) return chainText(fn);
  }
  if (n.type === 'subscript') {
    const v = n.childForFieldName('value');
    if (v) return chainText(v);
  }
  return n.text;
}

function resolveAlias(chain: string, aliases: Map<string, string>): string {
  const dot = chain.indexOf('.');
  const head = dot === -1 ? chain : chain.slice(0, dot);
  const rest = dot === -1 ? '' : chain.slice(dot);
  const full = aliases.get(head);
  const resolved = full ? full + rest : chain;
  // pytest marks are recognised by their tail regardless of how pytest was imported.
  const mark = /(^|\.)mark\.([A-Za-z_]\w*)$/.exec(resolved);
  if (mark) return `pytest.mark.${mark[2]}`;
  return resolved;
}

interface CallParts {
  chain: string;
  positional: Node[];
  keywords: Map<string, Node>;
  node: Node;
}

/** Split a call (or a bare name used like a decorator) into callee and arguments. */
function callParts(node: Node, aliases: Map<string, string>): CallParts | undefined {
  const n = unwrap(node);
  if (n.type === 'call') {
    const fn = n.childForFieldName('function');
    const args = n.childForFieldName('arguments');
    if (!fn) return undefined;
    const positional: Node[] = [];
    const keywords = new Map<string, Node>();
    if (args && args.type === 'argument_list') {
      for (const a of args.namedChildren) {
        if (a.type === 'comment') continue;
        if (a.type === 'keyword_argument') {
          const k = a.childForFieldName('name');
          const v = a.childForFieldName('value');
          if (k && v) keywords.set(k.text, v);
        } else {
          positional.push(a);
        }
      }
    }
    return { chain: resolveAlias(chainText(fn), aliases), positional, keywords, node: n };
  }
  if (n.type === 'identifier' || n.type === 'attribute') {
    return { chain: resolveAlias(chainText(n), aliases), positional: [], keywords: new Map(), node: n };
  }
  return undefined;
}

/** Fold a condition to a constant when it is a literal; undefined when dynamic. */
function foldCondition(node: Node): boolean | undefined {
  const n = unwrap(node);
  switch (n.type) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'none':
      return false;
    case 'integer':
      return Number(n.text) !== 0;
    case 'float':
      return Number(n.text) !== 0;
    case 'string':
    case 'concatenated_string':
      return (stringValue(n) ?? '').length > 0;
    case 'not_operator': {
      const inner = n.namedChildren[0];
      if (!inner) return undefined;
      const v = foldCondition(inner);
      return v === undefined ? undefined : !v;
    }
    default:
      return undefined;
  }
}

function isLiteral(node: Node): boolean {
  const n = unwrap(node);
  if (LITERAL_TYPES.has(n.type)) return true;
  if (n.type === 'unary_operator') {
    const inner = n.namedChildren[0];
    return !!inner && (inner.type === 'integer' || inner.type === 'float');
  }
  return false;
}

/** Blocks nested directly in a compound statement, including its clauses. */
function childBlocks(stmt: Node): Node[] {
  const blocks: Node[] = [];
  for (const c of stmt.namedChildren) {
    if (c.type === 'block') blocks.push(c);
    else if (c.type.endsWith('_clause')) {
      for (const cc of c.namedChildren) if (cc.type === 'block') blocks.push(cc);
    }
  }
  return blocks;
}

function isDefinition(stmt: Node): boolean {
  return stmt.type === 'function_definition' || stmt.type === 'class_definition' || stmt.type === 'decorated_definition';
}

function decoratorsOf(def: Node): Node[] {
  const parent = def.parent;
  if (!parent || parent.type !== 'decorated_definition') return [];
  return parent.namedChildren.filter((c) => c.type === 'decorator');
}

function decoratorExpression(decorator: Node): Node | undefined {
  return decorator.namedChildren.find((c) => c.type !== 'comment');
}

/** Enclosing class definitions, outermost first. Undefined when nested in a function. */
function enclosingClasses(def: Node): Node[] | undefined {
  const classes: Node[] = [];
  let n: Node | null = def.parent;
  while (n) {
    if (n.type === 'function_definition') return undefined;
    if (n.type === 'class_definition') classes.unshift(n);
    n = n.parent;
  }
  return classes;
}

// ---------------------------------------------------------------------------
// Imports and framework detection

function collectImports(root: Node, aliases: Map<string, string>): string[] {
  const imports: string[] = [];
  for (const node of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
    if (node.type === 'import_statement') {
      for (const c of node.namedChildren) {
        if (c.type === 'dotted_name') {
          imports.push(c.text);
          const head = c.text.split('.')[0]!;
          aliases.set(head, head);
        } else if (c.type === 'aliased_import') {
          const name = c.childForFieldName('name');
          const alias = c.childForFieldName('alias');
          if (name) {
            imports.push(name.text);
            if (alias) aliases.set(alias.text, name.text);
          }
        }
      }
    } else {
      const moduleNode = node.childForFieldName('module_name');
      const moduleName = moduleNode?.text ?? '';
      const prefix = moduleName.endsWith('.') ? moduleName : `${moduleName}.`;
      const names = node.namedChildren.filter((c) => c.id !== moduleNode?.id);
      for (const c of names) {
        if (c.type === 'dotted_name') {
          imports.push(`${prefix}${c.text}`);
          aliases.set(c.text, `${prefix}${c.text}`);
        } else if (c.type === 'aliased_import') {
          const name = c.childForFieldName('name');
          const alias = c.childForFieldName('alias');
          if (name) {
            imports.push(`${prefix}${name.text}`);
            if (alias) aliases.set(alias.text, `${prefix}${name.text}`);
          }
        } else if (c.type === 'wildcard_import') {
          imports.push(`${prefix}*`);
        }
      }
    }
  }
  return imports;
}

function detectFramework(imports: string[], source: string, hasTestCaseClass: boolean, profile: FrameworkProfile): PythonFramework {
  const roots = imports.map((i) => i.split('.')[0]);
  if (roots.includes('pytest') || roots.includes('_pytest')) return 'pytest';
  if (roots.includes('unittest') || hasTestCaseClass) return 'unittest';
  if (/\bpytest\./.test(source)) return 'pytest';
  if (profile.frameworks.has('pytest')) return 'pytest';
  if (profile.frameworks.has('unittest')) return 'unittest';
  return 'pytest';
}

// ---------------------------------------------------------------------------
// Markers

function reasonOf(parts: CallParts, positionalIndex: number): string | undefined {
  const kw = parts.keywords.get('reason');
  if (kw) return stringValue(kw) ?? kw.text;
  const pos = parts.positional[positionalIndex];
  if (pos) {
    const s = stringValue(pos);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** Interpret a decorator or pytestmark expression as a skip style marker. */
function markerFromExpression(expr: Node, aliases: Map<string, string>): SkipMarker | undefined {
  const parts = callParts(expr, aliases);
  if (!parts) return undefined;
  const chain = parts.chain;
  const at = line(expr);

  const conditional = (
    marker: string,
    kind: 'skip' | 'xfail',
    inverted: boolean,
    reasonIndex: number,
  ): SkipMarker => {
    const cond = parts.positional[0] && stringValue(parts.positional[0]) === undefined ? parts.positional[0] : undefined;
    const condKw = parts.keywords.get('condition');
    const condNode = cond ?? condKw;
    const reason = reasonOf(parts, cond ? reasonIndex : 0);
    const m: SkipMarker = { marker, kind, line: at };
    if (reason !== undefined) m.reason = reason;
    if (!condNode) {
      m.constant = true;
      return m;
    }
    let folded = foldCondition(condNode);
    if (folded !== undefined && inverted) folded = !folded;
    if (folded === true) {
      m.constant = true;
    } else {
      m.constant = false;
      if (kind === 'skip') m.kind = 'conditional-skip';
    }
    return m;
  };

  switch (chain) {
    case 'pytest.mark.skip': {
      const m: SkipMarker = { marker: chain, kind: 'skip', constant: true, line: at };
      const reason = reasonOf(parts, 0);
      if (reason !== undefined) m.reason = reason;
      return m;
    }
    case 'pytest.mark.skipif':
      return conditional(chain, 'skip', false, 1);
    case 'pytest.mark.xfail': {
      const m = conditional(chain, 'xfail', false, 1);
      const strict = parts.keywords.get('strict');
      if (strict && foldCondition(strict) === true) m.marker = 'pytest.mark.xfail(strict=True)';
      return m;
    }
    case 'unittest.skip':
    case 'skip': {
      const m: SkipMarker = { marker: 'unittest.skip', kind: 'skip', constant: true, line: at };
      const reason = reasonOf(parts, 0);
      if (reason !== undefined) m.reason = reason;
      return m;
    }
    case 'unittest.skipIf':
    case 'skipIf':
      return conditional('unittest.skipIf', 'skip', false, 1);
    case 'unittest.skipUnless':
    case 'skipUnless':
      return conditional('unittest.skipUnless', 'skip', true, 1);
    case 'unittest.expectedFailure':
    case 'expectedFailure':
      return { marker: 'unittest.expectedFailure', kind: 'xfail', constant: true, line: at };
    default:
      return undefined;
  }
}

function markersFromDecorators(def: Node, aliases: Map<string, string>): SkipMarker[] {
  const out: SkipMarker[] = [];
  for (const d of decoratorsOf(def)) {
    const expr = decoratorExpression(d);
    if (!expr) continue;
    const m = markerFromExpression(expr, aliases);
    if (m) out.push(m);
    // Per case marks: @pytest.mark.parametrize("x", [pytest.param(1, marks=pytest.mark.xfail(reason="..."))])
    const parts = callParts(expr, aliases);
    if (parts && parts.chain === 'pytest.mark.parametrize') {
      const values = parts.positional[1] ?? parts.keywords.get('argvalues');
      const v = values ? unwrap(values) : undefined;
      if (v && (v.type === 'list' || v.type === 'tuple')) {
        for (const item of v.namedChildren) {
          const ip = callParts(unwrap(item), aliases);
          if (!ip || ip.chain !== 'pytest.param') continue;
          const marks = ip.keywords.get('marks');
          if (!marks) continue;
          const mu = unwrap(marks);
          const markNodes = mu.type === 'list' || mu.type === 'tuple' ? mu.namedChildren : [mu];
          for (const mn of markNodes) {
            const pm = markerFromExpression(unwrap(mn), aliases) ?? markerFromBareMark(unwrap(mn), aliases, line(mn));
            if (pm) out.push({ ...pm, marker: `pytest.param(marks=${pm.marker})` });
          }
        }
      }
    }
  }
  return out;
}

/** `pytest.mark.xfail` without a call (bare attribute) used as a mark. */
function markerFromBareMark(node: Node, aliases: Map<string, string>, at: number): SkipMarker | undefined {
  const text = node.text.replace(/\s+/g, '');
  const chain = resolveAlias(text, aliases);
  if (chain === 'pytest.mark.xfail') return { marker: chain, kind: 'xfail', constant: true, line: at };
  if (chain === 'pytest.mark.skip') return { marker: chain, kind: 'skip', constant: true, line: at };
  return undefined;
}

/** Markers from `pytestmark = ...` assignments and module level `pytest.skip(...)`. */
function fileMarkersOf(root: Node, testsQuery: Query, aliases: Map<string, string>): SkipMarker[] {
  const out: SkipMarker[] = [];
  for (const match of testsQuery.matches(root)) {
    const value = match.captures.find((c) => c.name === 'pytestmark.value')?.node;
    if (!value) continue;
    const v = unwrap(value);
    const items = v.type === 'list' || v.type === 'tuple' ? v.namedChildren : [v];
    for (const item of items) {
      const m = markerFromExpression(item, aliases);
      if (m) out.push(m);
    }
  }
  for (const stmt of statements(root)) {
    if (stmt.type !== 'expression_statement') continue;
    const call = stmt.namedChildren[0];
    if (!call) continue;
    const parts = callParts(call, aliases);
    if (parts && parts.chain === 'pytest.skip') {
      const m: SkipMarker = { marker: 'pytest.skip', kind: 'skip', constant: true, line: line(stmt) };
      const reason = reasonOf(parts, 0);
      if (reason !== undefined) m.reason = reason;
      out.push(m);
    }
  }
  return out;
}

/** `pytest.skip(...)`, `self.skipTest(...)` or `raise SkipTest(...)` as the first statement. */
function firstStatementSkip(body: Node | null, aliases: Map<string, string>): SkipMarker | undefined {
  const first = statements(body).find((s) => !isDocstring(s));
  if (!first) return undefined;
  let callNode: Node | undefined;
  if (first.type === 'expression_statement') callNode = first.namedChildren[0];
  else if (first.type === 'raise_statement') callNode = first.namedChildren[0];
  if (!callNode) return undefined;
  const parts = callParts(callNode, aliases);
  if (!parts || parts.node.type !== 'call') return undefined;
  const tail = parts.chain.split('.').pop() ?? '';
  let marker: string | undefined;
  let kind: SkipMarker['kind'] = 'skip';
  if (parts.chain === 'pytest.skip') marker = 'pytest.skip';
  else if (parts.chain === 'pytest.xfail') {
    // Imperative xfail: the rest of the body never runs, same as a decorator.
    marker = 'pytest.xfail';
    kind = 'xfail';
  } else if (tail === 'skipTest') marker = 'self.skipTest';
  else if (first.type === 'raise_statement' && tail === 'SkipTest') marker = 'unittest.SkipTest';
  if (!marker) return undefined;
  const m: SkipMarker = { marker, kind, constant: true, line: line(first) };
  const reason = reasonOf(parts, 0);
  if (reason !== undefined) m.reason = reason;
  return m;
}

// ---------------------------------------------------------------------------
// Parametrize

/**
 * Argument names of `@pytest.mark.parametrize` decorators whose values are a
 * literal list or tuple. An `==` against one of these names is as strict as an
 * `==` against the literal it stands for.
 */
function literalParametrizeNames(def: Node, aliases: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const d of decoratorsOf(def)) {
    const expr = decoratorExpression(d);
    if (!expr) continue;
    const parts = callParts(expr, aliases);
    if (!parts || parts.chain !== 'pytest.mark.parametrize') continue;
    const names = parts.positional[0] ?? parts.keywords.get('argnames');
    const values = parts.positional[1] ?? parts.keywords.get('argvalues');
    if (!names || !values) continue;
    const v = unwrap(values);
    if (parametrizeCaseCount(v.type, v.namedChildren.filter((c) => c.type !== 'comment').length) === undefined) continue;
    const n = unwrap(names);
    const text = stringValue(n);
    if (text !== undefined) {
      for (const part of text.split(',')) if (part.trim()) out.add(part.trim());
    } else if (n.type === 'list' || n.type === 'tuple') {
      for (const item of n.namedChildren) {
        const sv = stringValue(item);
        if (sv !== undefined && sv.trim()) out.add(sv.trim());
      }
    }
  }
  return out;
}

/** True when the definition carries any pytest.mark.parametrize decorator, literal or dynamic. */
function isParametrized(def: Node, aliases: Map<string, string>): boolean {
  for (const d of decoratorsOf(def)) {
    const expr = decoratorExpression(d);
    if (!expr) continue;
    const parts = callParts(expr, aliases);
    if (parts && parts.chain === 'pytest.mark.parametrize') return true;
  }
  return false;
}

/** Catch blocks in the body that swallow exceptions: bare except, except Exception or BaseException, whose body neither raises, fails nor asserts. */
function collectCatchAlls(body: Node | null): CatchAll[] {
  const out: CatchAll[] = [];
  if (!body) return out;
  const stack: Node[] = [body];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'function_definition' || node.type === 'lambda') continue;
    if (node.type === 'try_statement') {
      const first = node.childForFieldName('body')?.namedChildren.find((c) => c.type !== 'comment');
      const snippet = normaliseText(first?.text ?? node.text).slice(0, 120);
      for (const clause of node.namedChildren) {
        if (clause.type !== 'except_clause') continue;
        const typeNode = clause.namedChildren.find((c) => c.type !== 'block' && c.type !== 'comment');
        const binding = typeNode ? typeNode.text.replace(/\s+as\s+\w+$/, '') : 'bare except';
        const broad = !typeNode || /^(Exception|BaseException|\(.*\b(Exception|BaseException)\b.*\))$/.test(binding);
        if (!broad) continue;
        const block = clause.childForFieldName('body') ?? clause.namedChildren.find((c) => c.type === 'block');
        const text = block?.text ?? '';
        const swallows = !/\b(raise|assert|pytest\.fail|self\.fail|fail\()/.test(text);
        out.push({ line: line(clause), binding, swallows, snippet });
      }
    }
    for (const c of node.namedChildren) stack.push(c);
  }
  return out;
}

/** Body is a single `super().test_x(...)` call or `return super().test_x(...)`, so the inherited test carries the oracle. */
function isOverrideOnly(body: Node | null): boolean {
  const stmts = statements(body).filter((s) => s.type !== 'comment' && !(s.type === 'expression_statement' && s.namedChildren[0]?.type === 'string'));
  if (stmts.length !== 1) return false;
  const st = stmts[0]!;
  const expr = st.type === 'return_statement' ? st.namedChildren[0] : st.type === 'expression_statement' ? st.namedChildren[0] : undefined;
  if (!expr) return false;
  return /^super\(\)\.\w+\(/.test(expr.text.replace(/\s+/g, ''));
}

function parametrizeCount(def: Node, aliases: Map<string, string>): number | undefined {
  let product: number | undefined;
  let sawDynamic = false;
  for (const d of decoratorsOf(def)) {
    const expr = decoratorExpression(d);
    if (!expr) continue;
    const parts = callParts(expr, aliases);
    if (!parts || parts.chain !== 'pytest.mark.parametrize') continue;
    const values = parts.positional[1] ?? parts.keywords.get('argvalues');
    if (!values) {
      sawDynamic = true;
      continue;
    }
    const v = unwrap(values);
    const count = parametrizeCaseCount(v.type, v.namedChildren.filter((c) => c.type !== 'comment').length);
    if (count === undefined) {
      sawDynamic = true;
      continue;
    }
    product = (product ?? 1) * count;
  }
  if (sawDynamic) return undefined;
  return product;
}

// ---------------------------------------------------------------------------
// Statement counting and body hash

function countStatements(block: Node | null): number {
  let n = 0;
  for (const stmt of statements(block)) {
    if (stmt.type === 'pass_statement' || isBareReturn(stmt) || isDocstring(stmt)) continue;
    n += 1;
    if (isDefinition(stmt)) continue;
    for (const b of childBlocks(stmt)) n += countStatements(b);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Assertions

function headerText(stmt: Node): string {
  const text = stmt.text;
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

function withLattice(a: Assertion, key: string): Assertion {
  const entry = latticeFor(key);
  if (entry) {
    a.family = entry.family;
    a.strength = entry.strength;
  }
  return a;
}

/** Classify a bare `assert` statement. */
function bareAssert(stmt: Node, aliases: Map<string, string>, literalParams?: Set<string>): Assertion {
  const expr = stmt.namedChildren.find((c) => c.type !== 'comment');
  const a: Assertion = { callee: 'assert', text: headerText(stmt), line: line(stmt), kind: 'value' };
  if (!expr) return a;
  let e = unwrap(expr);
  if (e.type === 'boolean_operator') {
    const first = e.namedChildren[0];
    if (first) e = unwrap(first);
  }
  if (MOCK_STATE_ATTR.test(e.text) || (e.type === 'comparison_operator' && MOCK_STATE_ATTR.test(e.namedChildren[0]?.text ?? ''))) {
    a.kind = 'interaction';
    a.subject = e.type === 'comparison_operator' ? e.namedChildren[0]!.text : e.text;
    return a;
  }
  if (e.type === 'comparison_operator') {
    const operands = e.namedChildren;
    const ops = e.children.filter((c) => !c.isNamed).map((c) => c.type);
    const left = operands[0]!;
    const right = operands[1];
    const op = ops[0] ?? '==';
    const approx = operands.some((o) => {
      const p = callParts(o, aliases);
      return p?.chain === 'pytest.approx';
    });
    const swapped = !!right && isLiteral(left) && !isLiteral(right);
    a.subject = swapped ? right!.text : left.text;
    // The expected operand of a two operand comparison, for tautology checks (A009).
    if (right && ops.length === 1) a.expected = swapped ? left.text : right.text;
    if (approx) return withLattice(a, 'assert.approx');
    if (ops.length > 1) return withLattice(a, 'assert.compare');
    switch (op) {
      case '==': {
        const literalRight = !!right && (isLiteral(right) || (right.type === 'identifier' && !!literalParams?.has(right.text)));
        return withLattice(a, literalRight ? 'assert.==.literal' : 'assert.==');
      }
      case '!=':
        return withLattice(a, 'assert.!=');
      case 'is not':
        if (right?.type === 'none') {
          a.kind = 'smoke';
          return withLattice(a, 'assert.is-not-none');
        }
        return withLattice(a, 'assert.is');
      case 'is':
        if (right?.type === 'none') return withLattice(a, 'assert.is-none');
        return withLattice(a, 'assert.is');
      case 'in':
      case 'not in':
        return withLattice(a, 'assert.in');
      default:
        return withLattice(a, 'assert.compare');
    }
  }
  if (e.type === 'not_operator') {
    const inner = e.namedChildren[0];
    a.subject = inner?.text ?? e.text;
    a.kind = 'smoke';
    return withLattice(a, 'assert.falsy');
  }
  const parts = callParts(e, aliases);
  if (parts && parts.node.type === 'call' && parts.chain === 'isinstance') {
    a.subject = parts.positional[0]?.text ?? e.text;
    a.kind = 'smoke';
    return withLattice(a, 'assert.isinstance');
  }
  a.subject = e.text;
  a.kind = 'smoke';
  return withLattice(a, 'assert.truthy');
}

function exceptionCallee(chain: string): string | undefined {
  if (PYTEST_EXCEPTION_CALLS.has(chain)) return chain;
  const tail = chain.split('.').pop() ?? '';
  if (/^assert(Raises|Warns)(Regex)?$/.test(tail)) return chain;
  return undefined;
}

/** The single statement inside a `with` block, as the subject of an exception assertion. */
function withBlockSubject(stmt: Node): string | undefined {
  const block = stmt.namedChildren.find((c) => c.type === 'block');
  const inner = statements(block).filter((s) => !isDocstring(s));
  if (inner.length !== 1) return undefined;
  const only = inner[0]!;
  if (only.type === 'expression_statement') {
    const expr = only.namedChildren[0];
    if (expr) {
      const u = unwrap(expr);
      if (u.type === 'assignment') {
        const right = u.childForFieldName('right');
        return right ? normaliseText(right.text) : normaliseText(u.text);
      }
      return normaliseText(u.text);
    }
  }
  return normaliseText(only.text);
}

/** Classify a call used as a statement: method, mock, function or custom helper. */
function callAssertion(stmt: Node, call: Node, ctx: FileContext): Assertion | undefined {
  const parts = callParts(call, ctx.aliases);
  if (!parts || parts.node.type !== 'call') return undefined;
  const fn = parts.node.childForFieldName('function');
  if (!fn) return undefined;
  const fnNode = unwrap(fn);
  const chain = parts.chain;
  const tail = chain.split('.').pop() ?? '';
  const base: Assertion = { callee: chain, text: headerText(stmt), line: line(stmt), kind: 'value' };
  const firstArg = parts.positional[0];

  if (MOCK_ASSERTION_METHODS.has(tail) && fnNode.type === 'attribute') {
    const receiver = fnNode.childForFieldName('object');
    base.callee = tail;
    base.kind = 'interaction';
    if (receiver) base.subject = receiver.text;
    return withLattice(base, tail);
  }
  if (exceptionCallee(chain)) {
    base.kind = 'exception';
    const subject = parts.positional[1] ?? firstArg;
    if (subject) base.subject = subject.text;
    return base;
  }
  if (fnNode.type === 'attribute' && Object.prototype.hasOwnProperty.call(UNITTEST_ASSERTIONS, tail)) {
    const receiver = fnNode.childForFieldName('object');
    const receiverText = receiver ? chainText(receiver) : '';
    base.callee = receiverText ? `${receiverText}.${tail}` : tail;
    base.kind = UNITTEST_ASSERTIONS[tail] as AssertionKind;
    if (firstArg) base.subject = firstArg.text;
    // Two operand assertions (assertEqual, assertIn, assertGreater) carry the expected operand second.
    const secondArg = parts.positional[1];
    if (secondArg && base.kind === 'value') base.expected = secondArg.text;
    return withLattice(base, tail);
  }
  // Custom helper defined in the same file: bare name, or self/cls method.
  if (ctx.helpers.has(tail)) {
    const receiverOk = fnNode.type === 'identifier' || /^(self|cls)\./.test(chain);
    if (receiverOk) {
      base.kind = 'custom';
      base.callee = fnNode.type === 'identifier' ? tail : chain;
      if (firstArg) base.subject = firstArg.text;
      return base;
    }
  }
  if (/^assert[A-Z_][A-Za-z_]*$/.test(tail)) {
    base.kind = 'value';
    if (firstArg) base.subject = firstArg.text;
    return base;
  }
  return undefined;
}

/** All assertions in a body, descending into compound statements but not nested definitions. */
function collectAssertions(block: Node | null, ctx: FileContext, out: Assertion[] = []): Assertion[] {
  for (const stmt of statements(block)) {
    if (isDefinition(stmt)) continue;
    if (stmt.type === 'assert_statement') {
      out.push(bareAssert(stmt, ctx.aliases, ctx.literalParams));
      continue;
    }
    if (stmt.type === 'with_statement') {
      const clause = stmt.namedChildren.find((c) => c.type === 'with_clause');
      for (const item of clause?.namedChildren ?? []) {
        if (item.type !== 'with_item') continue;
        const value = item.childForFieldName('value');
        if (!value) continue;
        const parts = callParts(value, ctx.aliases);
        if (!parts || parts.node.type !== 'call') continue;
        const callee = exceptionCallee(parts.chain);
        if (!callee) continue;
        const a: Assertion = { callee, text: headerText(stmt), line: line(stmt), kind: 'exception' };
        const subject = withBlockSubject(stmt);
        if (subject) a.subject = subject;
        out.push(a);
      }
    }
    if (stmt.type === 'expression_statement') {
      const expr = stmt.namedChildren[0];
      if (expr) {
        const u = unwrap(expr);
        if (u.type === 'call') {
          const a = callAssertion(stmt, u, ctx);
          if (a) out.push(a);
        } else if (u.type === 'assignment' || u.type === 'augmented_assignment') {
          // `msg = self.assertEmailMessageSent()`: an assertion helper used for its return value still asserts.
          const right = u.childForFieldName('right');
          const rv = right ? unwrap(right) : undefined;
          if (rv && rv.type === 'call') {
            const a = callAssertion(stmt, rv, ctx);
            if (a) out.push(a);
          }
        }
      }
    }
    for (const b of childBlocks(stmt)) collectAssertions(b, ctx, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mocks

function mockTarget(parts: CallParts): string | undefined {
  const chain = parts.chain;
  const segs = chain.split('.');
  const tail = segs[segs.length - 1] ?? '';
  const pos = parts.positional;
  const text = (n: Node | undefined): string | undefined => (n ? (stringValue(n) ?? normaliseText(n.text)) : undefined);

  if (tail === 'patch' || tail === 'object' || tail === 'dict' || tail === 'multiple') {
    const isObject = tail === 'object' && segs[segs.length - 2] === 'patch';
    const isDict = (tail === 'dict' || tail === 'multiple') && segs[segs.length - 2] === 'patch';
    if (tail === 'patch') {
      const head = segs.slice(0, -1).join('.');
      if (head && !MOCK_RECEIVERS.has(head) && !/(^|\.)(mock|mocker)$/.test(head)) return undefined;
      const target = text(pos[0]) ?? text(parts.keywords.get('target'));
      return target;
    }
    if (isObject) {
      const head = segs.slice(0, -2).join('.');
      if (head && !MOCK_RECEIVERS.has(head) && !/(^|\.)(mock|mocker)$/.test(head)) return undefined;
      const target = pos[0] ? normaliseText(pos[0].text) : undefined;
      const attr = text(pos[1]) ?? text(parts.keywords.get('attribute'));
      if (!target) return undefined;
      return attr ? `${target}.${attr}` : target;
    }
    if (isDict) {
      const head = segs.slice(0, -2).join('.');
      if (head && !MOCK_RECEIVERS.has(head) && !/(^|\.)(mock|mocker)$/.test(head)) return undefined;
      return text(pos[0]);
    }
    return undefined;
  }
  if (tail === 'setattr' || tail === 'setitem') {
    const receiver = segs.slice(0, -1).join('.');
    if (!/^(monkeypatch|mp|mocker\.patch)$/.test(receiver)) return undefined;
    if (pos.length >= 3 && pos[0] && pos[1]) {
      return `${normaliseText(pos[0].text)}.${text(pos[1])}`;
    }
    return text(pos[0]);
  }
  if (tail === 'setenv') {
    const receiver = segs.slice(0, -1).join('.');
    if (!/^(monkeypatch|mp)$/.test(receiver)) return undefined;
    const key = text(pos[0]);
    return key ? `os.environ.${key}` : undefined;
  }
  return undefined;
}

function collectMocks(nodes: Node[], mocksQuery: Query, aliases: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const match of mocksQuery.matches(node)) {
      const call = match.captures.find((c) => c.name === 'mock.call')?.node;
      if (!call) continue;
      // Skip calls that belong to a nested function definition inside the test.
      if (nestedInDefinitionBelow(call, node)) continue;
      const parts = callParts(call, aliases);
      if (!parts) continue;
      const target = mockTarget(parts);
      if (target && !seen.has(target)) {
        seen.add(target);
        out.push(target);
      }
    }
  }
  return out;
}

function nestedInDefinitionBelow(node: Node, root: Node): boolean {
  let n: Node | null = node.parent;
  while (n && n.id !== root.id) {
    if (n.type === 'function_definition' || n.type === 'class_definition' || n.type === 'lambda') return true;
    n = n.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Collection rules

interface ClassInfo {
  node: Node;
  name: string;
  isTestClass: boolean;
  isTestCase: boolean;
}

function classHasInit(cls: Node): boolean {
  const body = cls.childForFieldName('body');
  for (const stmt of statements(body)) {
    const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
    if (def?.type === 'function_definition' && def.childForFieldName('name')?.text === '__init__') return true;
  }
  return false;
}

function classInfo(cls: Node, aliases: Map<string, string>, cache: Map<number, ClassInfo>): ClassInfo {
  const cached = cache.get(cls.id);
  if (cached) return cached;
  const name = cls.childForFieldName('name')?.text ?? '';
  const supers = cls.childForFieldName('superclasses');
  let isTestCase = false;
  for (const base of supers?.namedChildren ?? []) {
    if (base.type === 'keyword_argument' || base.type === 'comment') continue;
    const chain = resolveAlias(chainText(base), aliases);
    if (TEST_CASE_BASE.test(chain)) {
      isTestCase = true;
      break;
    }
  }
  const isTestClass = isTestCase || (TEST_CLASS_NAME.test(name) && !classHasInit(cls));
  const info = { node: cls, name, isTestClass, isTestCase };
  cache.set(cls.id, info);
  return info;
}

function hasFixtureDecorator(def: Node, aliases: Map<string, string>): boolean {
  return decoratorsOf(def).some((d) => {
    const expr = decoratorExpression(d);
    if (!expr) return false;
    const parts = callParts(expr, aliases);
    if (!parts) return false;
    return parts.chain === 'pytest.fixture' || parts.chain === 'fixture' || /\.fixture$/.test(parts.chain);
  });
}

// ---------------------------------------------------------------------------
// Entry point

export async function buildInventory(path: string, source: string, profile: FrameworkProfile): Promise<TestInventory> {
  const { tree, grammar } = await parsePython(source);
  const root = tree.rootNode;
  const aliases = new Map<string, string>();
  const imports = collectImports(root, aliases);
  const classCache = new Map<number, ClassInfo>();

  // Pass 1: find every function definition and its enclosing classes.
  interface Candidate {
    def: Node;
    name: string;
    classes: Node[];
    body: Node | null;
  }
  const candidates: Candidate[] = [];
  const seenDefs = new Set<number>();
  for (const capture of grammar.queries.tests.captures(root)) {
    if (capture.name !== 'test.def') continue;
    const def = capture.node;
    if (seenDefs.has(def.id)) continue;
    seenDefs.add(def.id);
    const classes = enclosingClasses(def);
    if (classes === undefined) continue;
    const name = def.childForFieldName('name')?.text ?? '';
    candidates.push({ def, name, classes, body: def.childForFieldName('body') });
  }

  const hasTestCaseClass = candidates.some((c) => c.classes.some((cls) => classInfo(cls, aliases, classCache).isTestCase));
  const framework = detectFramework(imports, source, hasTestCaseClass, profile);

  const isTest = (c: Candidate): boolean => {
    if (!TEST_NAME.test(c.name)) return false;
    if (hasFixtureDecorator(c.def, aliases)) return false;
    return c.classes.every((cls) => classInfo(cls, aliases, classCache).isTestClass);
  };

  // Pass 2: assertion helpers, one level deep (direct assertions only).
  const helperCtx: FileContext = { aliases, helpers: new Set(), framework };
  const helpers = new Set<string>();
  for (const c of candidates) {
    if (TEST_NAME.test(c.name)) continue;
    if (collectAssertions(c.body, helperCtx).length > 0) helpers.add(c.name);
  }
  for (const name of profile.extraAssertions) helpers.add(name);
  const ctx: FileContext = { aliases, helpers, framework };

  const fileMarkers = fileMarkersOf(root, grammar.queries.tests, aliases);

  // Pass 3: build each test case.
  const tests: TestCase[] = [];
  for (const c of candidates) {
    if (!isTest(c)) continue;
    const container = c.classes.map((cls) => classInfo(cls, aliases, classCache).name);
    const qualifiedName = [...container, c.name].join('::');
    const bodyText = c.body?.text ?? '';
    const decorated = c.def.parent?.type === 'decorated_definition' ? c.def.parent : c.def;

    const markers: SkipMarker[] = [...fileMarkers];
    for (const cls of c.classes) markers.push(...markersFromDecorators(cls, aliases));
    markers.push(...markersFromDecorators(c.def, aliases));
    const firstSkip = firstStatementSkip(c.body, aliases);
    if (firstSkip) markers.push(firstSkip);

    let parameterCount = parametrizeCount(c.def, aliases);
    for (const cls of c.classes) {
      const clsCount = parametrizeCount(cls, aliases);
      if (clsCount !== undefined) parameterCount = (parameterCount ?? 1) * clsCount;
    }

    const mockNodes: Node[] = [];
    for (const cls of c.classes) {
      for (const d of decoratorsOf(cls)) mockNodes.push(d);
    }
    mockNodes.push(...decoratorsOf(c.def));
    if (c.body) mockNodes.push(c.body);

    const test: TestCase = {
      name: c.name,
      qualifiedName,
      container,
      startLine: line(decorated),
      endLine: endLine(c.def),
      bodyHash: shortHash(normaliseText(bodyText)),
      statementCount: countStatements(c.body),
      assertions: collectAssertions(c.body, { ...ctx, literalParams: literalParametrizeNames(c.def, aliases) }),
      markers,
      mocks: collectMocks(mockNodes, grammar.queries.mocks, aliases),
      framework,
    };
    if (parameterCount !== undefined) test.parameterCount = parameterCount;
    if (isParametrized(c.def, aliases) || c.classes.some((cls) => isParametrized(cls, aliases))) test.parameterised = true;
    const catchAlls = collectCatchAlls(c.body);
    if (catchAlls.length) test.catchAlls = catchAlls;
    if (isOverrideOnly(c.body)) test.overrideOnly = true;
    tests.push(test);
  }

  const inventory: TestInventory = {
    path,
    language: 'python',
    framework,
    tests,
    assertionHelpers: new Set([...helpers].filter((h) => !profile.extraAssertions.includes(h))),
    imports,
    fileMarkers,
    parseErrors: countParseErrors(root),
  };
  tree.delete();
  return inventory;
}
