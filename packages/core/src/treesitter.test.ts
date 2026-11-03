import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'web-tree-sitter';
import { compileQuery, countParseErrors, initTreeSitter, loadLanguage, normaliseText, parseSource } from './treesitter.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const req = createRequire(join(HERE, '../../lang-python/package.json'));
const PY_WASM = req.resolve('tree-sitter-python/tree-sitter-python.wasm');

let py: Language;

beforeAll(async () => {
  py = await loadLanguage(PY_WASM);
});

describe('initTreeSitter', () => {
  it('is idempotent', async () => {
    await expect(initTreeSitter()).resolves.toBeUndefined();
    await expect(initTreeSitter()).resolves.toBeUndefined();
    await expect(Promise.all([initTreeSitter(), initTreeSitter()])).resolves.toEqual([undefined, undefined]);
  });
});

describe('loadLanguage', () => {
  it('returns a usable language', () => {
    expect(py).toBeDefined();
    expect(py.name).toBe('python');
  });
  it('caches the language for the same path', async () => {
    const again = await loadLanguage(PY_WASM);
    expect(again).toBe(py);
    const [a, b] = await Promise.all([loadLanguage(PY_WASM), loadLanguage(PY_WASM)]);
    expect(a).toBe(b);
    expect(a).toBe(py);
  });
  it('rejects for a missing wasm', async () => {
    await expect(loadLanguage(join(HERE, 'no-such-grammar.wasm'))).rejects.toThrow();
  });
});

describe('compileQuery', () => {
  it('caches per name', () => {
    const a = compileQuery(py, 'tw-test-defs', '(function_definition name: (identifier) @n)');
    const b = compileQuery(py, 'tw-test-defs', '(class_definition name: (identifier) @n)');
    expect(b).toBe(a);
  });
  it('compiles a separate query for a different name', () => {
    const a = compileQuery(py, 'tw-test-one', '(function_definition name: (identifier) @n)');
    const c = compileQuery(py, 'tw-test-two', '(class_definition name: (identifier) @n)');
    expect(c).not.toBe(a);
  });
  it('produces a query that matches', () => {
    const q = compileQuery(py, 'tw-test-match', '(function_definition name: (identifier) @n)');
    const tree = parseSource(py, 'def a():\n    pass\n\ndef b():\n    pass\n');
    const names = q.captures(tree.rootNode).map((c) => c.node.text);
    expect(names).toEqual(['a', 'b']);
  });
});

describe('parseSource and countParseErrors', () => {
  it('returns a tree for valid source with no parse errors', () => {
    const tree = parseSource(py, 'def test_a():\n    assert 1 == 1\n');
    expect(tree.rootNode.type).toBe('module');
    expect(tree.rootNode.hasError).toBe(false);
    expect(countParseErrors(tree.rootNode)).toBe(0);
  });
  it('counts errors in broken source', () => {
    const tree = parseSource(py, 'def test_a(:\n    assert ==\n');
    expect(tree.rootNode.hasError).toBe(true);
    expect(countParseErrors(tree.rootNode)).toBeGreaterThan(0);
  });
  it('counts missing nodes', () => {
    const tree = parseSource(py, 'x = (1 + \n');
    expect(countParseErrors(tree.rootNode)).toBeGreaterThan(0);
  });
  it('parses an empty file', () => {
    const tree = parseSource(py, '');
    expect(tree.rootNode.type).toBe('module');
    expect(countParseErrors(tree.rootNode)).toBe(0);
  });
});

describe('normaliseText', () => {
  it('strips block comments', () => {
    expect(normaliseText('a /* gone\n still */ b')).toBe('a b');
  });
  it('strips line comments', () => {
    expect(normaliseText('a // gone\nb')).toBe('a b');
    expect(normaliseText('// first line\nb')).toBe('b');
  });
  it('keeps a url scheme', () => {
    expect(normaliseText('fetch("http://x.test/a")')).toBe('fetch("http://x.test/a")');
  });
  it('strips hash comments', () => {
    expect(normaliseText('a # gone\nb')).toBe('a b');
    expect(normaliseText('# gone\nb')).toBe('b');
  });
  it('keeps a hash glued to code', () => {
    expect(normaliseText('a#b')).toBe('a#b');
  });
  it('collapses whitespace and trims', () => {
    expect(normaliseText('  a \t\n\n b   c  ')).toBe('a b c');
    expect(normaliseText('')).toBe('');
    expect(normaliseText('   ')).toBe('');
  });
  it('gives equal output for bodies that differ only in comments and layout', () => {
    expect(normaliseText('x = 1  # one\ny = 2')).toBe(normaliseText('x = 1\n\n  y = 2 # two'));
  });
});
