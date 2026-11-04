// Bundle the CLI into packages/cli/dist/cli.js plus packages/cli/dist/assets (wasm grammars and .scm queries),
// the self contained layout that npm publishes as the `testwitness` package.
// Every dependency, workspace or third party, is inlined, so the published manifest has no dependencies.
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages/cli');
const dist = join(pkgDir, 'dist');
const assets = join(dist, 'assets');
// Clear the whole dist so stale tsc output never sits next to the bundle.
rmSync(dist, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

await build({
  entryPoints: [join(pkgDir, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(dist, 'cli.js'),
  conditions: ['development'],
  // platform node already treats node: builtins as external; nothing else is.
  banner: {
    js: [
      "import { createRequire as __tw_createRequire } from 'node:module';",
      'const require = __tw_createRequire(import.meta.url);',
      "import { dirname as __tw_dirname, join as __tw_join } from 'node:path';",
      "import { fileURLToPath as __tw_ftp } from 'node:url';",
      // Assets live next to the bundle unless the caller points TESTWITNESS_ASSET_DIR elsewhere.
      "process.env.TESTWITNESS_ASSET_DIR ||= __tw_join(__tw_dirname(__tw_ftp(import.meta.url)), 'assets');",
    ].join('\n'),
  },
  legalComments: 'none',
  logLevel: 'warning',
});

const resolveFrom = (dir, spec) => createRequire(join(root, dir, 'package.json')).resolve(spec);
const wasm = [
  [resolveFrom('packages/core', 'web-tree-sitter/web-tree-sitter.wasm'), 'web-tree-sitter.wasm'],
  [resolveFrom('packages/lang-java', 'tree-sitter-java/tree-sitter-java.wasm'), 'tree-sitter-java.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-typescript/tree-sitter-typescript.wasm'), 'tree-sitter-typescript.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-typescript/tree-sitter-tsx.wasm'), 'tree-sitter-tsx.wasm'],
  [resolveFrom('packages/lang-ts', 'tree-sitter-javascript/tree-sitter-javascript.wasm'), 'tree-sitter-javascript.wasm'],
  [resolveFrom('packages/lang-python', 'tree-sitter-python/tree-sitter-python.wasm'), 'tree-sitter-python.wasm'],
];
for (const [src, name] of wasm) copyFileSync(src, join(assets, name));
for (const [pkg, name] of [['lang-java', 'java'], ['lang-ts', 'ts'], ['lang-python', 'python']]) {
  const q = join(root, 'packages', pkg, 'queries');
  if (!existsSync(q) || !readdirSync(q).some((f) => f.endsWith('.scm'))) {
    throw new Error(`no .scm queries found in ${q}`);
  }
  cpSync(q, join(assets, 'queries', name), { recursive: true, filter: (src) => !/\.(test|spec)\./.test(src) });
}

// npm always ships README and LICENSE; take both from the repo root so they never drift.
copyFileSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));
copyFileSync(join(root, 'README.md'), join(pkgDir, 'README.md'));

process.stdout.write('bundled packages/cli/dist/cli.js and packages/cli/dist/assets\n');
