// Bundle the GitHub Action into dist/index.js plus dist/assets (wasm grammars and .scm queries).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');
rmSync(dist, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

await build({
  entryPoints: [join(root, 'packages/action/src/entry.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: join(dist, 'index.js'),
  conditions: ['development'],
  banner: {
    js: [
      "import { createRequire as __tw_createRequire } from 'node:module';",
      'const require = __tw_createRequire(import.meta.url);',
      "import { dirname as __tw_dirname, join as __tw_join } from 'node:path';",
      "import { fileURLToPath as __tw_ftp } from 'node:url';",
      "process.env.TESTWITNESS_ASSET_DIR ??= __tw_join(__tw_dirname(__tw_ftp(import.meta.url)), 'assets');",
    ].join('\n'),
  },
  logLevel: 'info',
});

const resolveFrom = (pkgDir, spec) => createRequire(join(root, pkgDir, 'package.json')).resolve(spec);
const wasm = [
  [resolveFrom('packages/core', 'web-tree-sitter/web-tree-sitter.wasm'), 'web-tree-sitter.wasm'],
  [resolveFrom('packages/lang-java', 'tree-sitter-java/tree-sitter-java.wasm'), 'tree-sitter-java.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-typescript/tree-sitter-typescript.wasm'), 'tree-sitter-typescript.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-typescript/tree-sitter-tsx.wasm'), 'tree-sitter-tsx.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-javascript/tree-sitter-javascript.wasm'), 'tree-sitter-javascript.wasm'],
  [resolveFrom('packages/lang-python', 'tree-sitter-python/tree-sitter-python.wasm'), 'tree-sitter-python.wasm'],
];
for (const [src, name] of wasm) cpSync(src, join(assets, name));
for (const [pkg, name] of [['lang-java', 'java'], ['lang-ts', 'ts'], ['lang-python', 'python']]) {
  const q = join(root, 'packages', pkg, 'queries');
  if (existsSync(q)) cpSync(q, join(assets, 'queries', name), { recursive: true });
}
process.stdout.write('bundled dist/index.js and dist/assets\n');
