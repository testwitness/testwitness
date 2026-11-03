/**
 * Grammar resolution for the TypeScript and JavaScript front end.
 *
 * Three wasm grammars are bundled through dependencies:
 *   .ts .mts .cts        tree-sitter-typescript/tree-sitter-typescript.wasm
 *   .tsx                 tree-sitter-typescript/tree-sitter-tsx.wasm
 *   .js .mjs .cjs .jsx   tree-sitter-javascript/tree-sitter-javascript.wasm
 *
 * The typescript and tsx grammars both report a null language name and the
 * same ABI version, so core's compileQuery cache key would collide between
 * them. Every query name is therefore prefixed with the grammar id.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileQuery, loadLanguage } from '@testwitness/core';
import type { Language, Query } from '@testwitness/core';

export type GrammarId = 'typescript' | 'tsx' | 'javascript';

export const TS_EXTENSIONS = ['.ts', '.mts', '.cts'] as const;
export const TSX_EXTENSIONS = ['.tsx'] as const;
export const JS_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx'] as const;
export const ALL_EXTENSIONS: string[] = [...TS_EXTENSIONS, ...TSX_EXTENSIONS, ...JS_EXTENSIONS];

const require = createRequire(import.meta.url);

const WASM_SPECIFIERS: Record<GrammarId, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
};

/** Pick the grammar for a file path by extension. Unknown extensions fall back to typescript. */
export function grammarForPath(path: string): GrammarId {
  const ext = extname(path).toLowerCase();
  if ((TSX_EXTENSIONS as readonly string[]).includes(ext)) return 'tsx';
  if ((JS_EXTENSIONS as readonly string[]).includes(ext)) return 'javascript';
  return 'typescript';
}

const WASM_FILES: Record<GrammarId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
};

/**
 * The bundled GitHub Action ships the wasm files and queries next to its entry point and
 * points TESTWITNESS_ASSET_DIR at that directory. Unset, assets resolve relative to the package.
 */
export function assetDir(): string | undefined {
  const dir = process.env['TESTWITNESS_ASSET_DIR'];
  return dir && dir.length > 0 ? dir : undefined;
}

export function wasmPathFor(id: GrammarId): string {
  const dir = assetDir();
  if (dir) return join(dir, WASM_FILES[id]);
  return require.resolve(WASM_SPECIFIERS[id]);
}

export async function languageFor(id: GrammarId): Promise<Language> {
  return loadLanguage(wasmPathFor(id));
}

export type QueryName = 'tests' | 'assertions' | 'markers' | 'mocks';

const QUERY_NAMES: QueryName[] = ['tests', 'assertions', 'markers', 'mocks'];
const querySources = new Map<string, string>();

export function queryPathFor(name: QueryName): string {
  const dir = assetDir();
  if (dir) return join(dir, 'queries', 'ts', `${name}.scm`);
  return fileURLToPath(new URL(`../queries/${name}.scm`, import.meta.url));
}

function querySource(name: QueryName): string {
  const path = queryPathFor(name);
  let src = querySources.get(path);
  if (src === undefined) {
    src = readFileSync(path, 'utf8');
    querySources.set(path, src);
  }
  return src;
}

export interface CompiledQueries {
  tests: Query;
  assertions: Query;
  markers: Query;
  mocks: Query;
}

const compiled = new Map<GrammarId, CompiledQueries>();

/** Load the grammar and compile the four concept queries once per grammar. */
export async function grammarFor(id: GrammarId): Promise<{ language: Language; queries: CompiledQueries }> {
  const language = await languageFor(id);
  let q = compiled.get(id);
  if (!q) {
    const built: Partial<CompiledQueries> = {};
    for (const name of QUERY_NAMES) {
      built[name] = compileQuery(language, `${id}:${name}`, querySource(name));
    }
    q = built as CompiledQueries;
    compiled.set(id, q);
  }
  return { language, queries: q };
}
