/**
 * Resolves and loads the bundled tree-sitter-java grammar and compiles the
 * query files under queries/ once per process.
 */
// @ts-nocheck

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLanguage, compileQuery } from '@testwitness/core';
import type { Language, Query } from '@testwitness/core';

export type QueryName = 'tests' | 'assertions' | 'markers' | 'mocks';

export interface JavaGrammar {
  language: Language;
  queries: Record<QueryName, Query>;
}

let grammar: Promise<JavaGrammar> | undefined;

/** Directory holding bundled assets when the tool runs from the packaged GitHub Action. */
function assetDir(): string | undefined {
  const dir = process.env['TESTWITNESS_ASSET_DIR'];
  return dir ? dir : undefined;
}

/** Absolute path to the tree-sitter-java wasm shipped with the dependency, or the copy under TESTWITNESS_ASSET_DIR. */
export function javaWasmPath(): string {
  const dir = assetDir();
  if (dir) return join(dir, 'tree-sitter-java.wasm');
  const req = createRequire(import.meta.url);
  return req.resolve('tree-sitter-java/tree-sitter-java.wasm');
}

/** Absolute path to one of the bundled query files, or the copy under TESTWITNESS_ASSET_DIR/queries/java. */
export function queryPath(name: QueryName): string {
  const dir = assetDir();
  if (dir) return join(dir, 'queries', 'java', `${name}.scm`);
  return fileURLToPath(new URL(`../queries/${name}.scm`, import.meta.url));
}

export function readQuerySource(name: QueryName): string {
  return readFileSync(queryPath(name), 'utf8');
}

/** Load the language and compile the four queries. Cached for the process. */
export function loadJavaGrammar(): Promise<JavaGrammar> {
  if (!grammar) {
    grammar = (async () => {
      const language = await loadLanguage(javaWasmPath());
      const names: QueryName[] = ['tests', 'assertions', 'markers', 'mocks'];
      const queries = {} as Record<QueryName, Query>;
      for (const name of names) {
        queries[name] = compileQuery(language, `java:${name}`, readQuerySource(name));
      }
      return { language, queries };
    })();
  }
  return grammar;
}
