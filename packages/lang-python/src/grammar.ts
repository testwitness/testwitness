/**
 * Resolves and loads the bundled tree-sitter-python wasm grammar and the
 * query files in ../queries. Everything is cached by core, so repeated calls
 * are cheap.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileQuery, loadLanguage, parseSource } from '@testwitness/core';
import type { Language, Query, Tree } from '@testwitness/core';

export type QueryName = 'tests' | 'assertions' | 'markers' | 'mocks';

export interface PythonGrammar {
  language: Language;
  queries: Record<QueryName, Query>;
}

const QUERY_NAMES: QueryName[] = ['tests', 'assertions', 'markers', 'mocks'];

let grammarPromise: Promise<PythonGrammar> | undefined;

/** Absolute path of the bundled tree-sitter-python wasm. */
export function pythonWasmPath(): string {
  const dir = process.env['TESTWITNESS_ASSET_DIR'];
  if (dir) return join(dir, 'tree-sitter-python.wasm');
  const req = createRequire(import.meta.url);
  return req.resolve('tree-sitter-python/tree-sitter-python.wasm');
}

/** Read a query file from the package's queries directory. */
export function readQuerySource(name: QueryName): string {
  const dir = process.env['TESTWITNESS_ASSET_DIR'];
  if (dir) return readFileSync(join(dir, 'queries', 'python', `${name}.scm`), 'utf8');
  const url = new URL(`../queries/${name}.scm`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

/** Load the Python language and compile the four queries once. */
export async function loadPythonGrammar(): Promise<PythonGrammar> {
  if (!grammarPromise) {
    grammarPromise = (async () => {
      const language = await loadLanguage(pythonWasmPath());
      const queries = {} as Record<QueryName, Query>;
      for (const name of QUERY_NAMES) {
        queries[name] = compileQuery(language, `python:${name}`, readQuerySource(name));
      }
      return { language, queries };
    })();
  }
  return grammarPromise;
}

/** Parse Python source into a tree using the cached language. */
export async function parsePython(source: string): Promise<{ tree: Tree; grammar: PythonGrammar }> {
  const grammar = await loadPythonGrammar();
  return { tree: parseSource(grammar.language, source), grammar };
}
