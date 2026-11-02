/**
 * Resolves and loads the bundled tree-sitter-java grammar and compiles the
 * query files under queries/ once per process.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLanguage, compileQuery } from '@testwitness/core';
import type { Language, Query } from '@testwitness/core';

export type QueryName = 'tests' | 'assertions' | 'markers' | 'mocks';

export interface JavaGrammar {
  language: Language;
  queries: Record<QueryName, Query>;
}

let grammar: Promise<JavaGrammar> | undefined;

/** Absolute path to the tree-sitter-java wasm shipped with the dependency. */
export function javaWasmPath(): string {
  const req = createRequire(import.meta.url);
  return req.resolve('tree-sitter-java/tree-sitter-java.wasm');
}

/** Absolute path to one of the bundled query files. */
export function queryPath(name: QueryName): string {
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
