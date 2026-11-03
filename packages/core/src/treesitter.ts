/**
 * Shared web-tree-sitter loading. Language packages hand in the path to their
 * bundled wasm grammar; this module caches the initialised parser runtime and
 * each loaded Language so a run parses hundreds of files with one init.
 */
import { Parser, Language, Query } from 'web-tree-sitter';
import type { Tree, Node } from 'web-tree-sitter';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type { Tree, Node };
export { Query, Language };

let initialised: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();
const queries = new Map<string, Query>();

/** Resolve the web-tree-sitter runtime wasm so bundlers and SEA builds can find it. */
function runtimeWasmPath(): string {
  const dir = process.env['TESTWITNESS_ASSET_DIR'];
  if (dir) return join(dir, 'web-tree-sitter.wasm');
  const req = createRequire(import.meta.url);
  return req.resolve('web-tree-sitter/web-tree-sitter.wasm');
}

export async function initTreeSitter(): Promise<void> {
  if (!initialised) {
    const wasmPath = runtimeWasmPath();
    const wasmBinary = readFileSync(wasmPath);
    initialised = Parser.init({ wasmBinary });
  }
  return initialised;
}

export async function loadLanguage(wasmPath: string): Promise<Language> {
  await initTreeSitter();
  let p = languages.get(wasmPath);
  if (!p) {
    p = Language.load(wasmPath);
    languages.set(wasmPath, p);
  }
  return p;
}

/** Compile a query once per (language, source) pair. */
export function compileQuery(language: Language, name: string, source: string): Query {
  const key = `${language.name ?? language.abiVersion}:${name}`;
  let q = queries.get(key);
  if (!q) {
    q = new Query(language, source);
    queries.set(key, q);
  }
  return q;
}

export function parseSource(language: Language, source: string): Tree {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  parser.delete();
  if (!tree) throw new Error('tree-sitter returned no tree');
  return tree;
}

/** Count ERROR and MISSING nodes, a cheap parse quality signal. */
export function countParseErrors(root: Node): number {
  let n = 0;
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.hasError && (node.type === 'ERROR' || node.isMissing)) n++;
    if (node.hasError) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c) stack.push(c);
      }
    }
  }
  return n;
}

/** Normalised text: collapse whitespace, strip comments crudely. Used for body hashes. */
export function normaliseText(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)#[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
