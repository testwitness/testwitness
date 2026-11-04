// Prove the published `testwitness` package works on its own, outside the workspace.
//
//   1. bundle the CLI (scripts/bundle-cli.mjs)
//   2. pnpm pack it into a temp dir and check the tarball manifest is clean
//   3. npm install the tarball into a fresh temp project (no workspace)
//   4. run `testwitness --version` and `testwitness check` on a temp git repo whose head
//      weakens a TypeScript, a Python and a Java test, and require findings
//
// Exits non zero on any failure. Used by the release workflow before publish.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'testwitness-pack-'));
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  process.stdout.write(`FAIL ${msg}\n`);
};
const ok = (msg) => process.stdout.write(`ok   ${msg}\n`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

// A clean environment: no asset dir override leaking in from the caller.
const cleanEnv = { ...process.env };
delete cleanEnv.TESTWITNESS_ASSET_DIR;

try {
  // 1. bundle
  run(process.execPath, [join(root, 'scripts/bundle-cli.mjs')], { cwd: root, stdio: 'inherit' });

  // 2. pack
  const packDir = join(work, 'pack');
  mkdirSync(packDir);
  run('pnpm', ['--filter', 'testwitness', 'pack', '--pack-destination', packDir], { cwd: root });
  const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`expected one tarball, found ${tarballs.join(', ') || 'none'}`);
  const tarball = join(packDir, tarballs[0]);

  const listing = run('tar', ['-tvzf', tarball])
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return { size: Number(parts[2]), path: parts.slice(5).join(' ') };
    })
    .filter((e) => !e.path.endsWith('/'));
  const unpacked = listing.reduce((n, e) => n + e.size, 0);
  const packed = readFileSync(tarball).length;
  process.stdout.write(`\ntarball ${tarballs[0]}\n`);
  for (const e of listing) process.stdout.write(`  ${String(e.size).padStart(9)}  ${e.path}\n`);
  process.stdout.write(`files: ${listing.length}\n`);
  process.stdout.write(`packed size: ${(packed / 1024).toFixed(1)} kB\n`);
  process.stdout.write(`unpacked size: ${(unpacked / 1024).toFixed(1)} kB (${unpacked} bytes)\n\n`);

  const paths = new Set(listing.map((e) => e.path.replace(/^package\//, '')));
  for (const required of ['package.json', 'bin/testwitness.js', 'dist/cli.js', 'LICENSE', 'README.md', 'dist/assets/web-tree-sitter.wasm']) {
    if (paths.has(required)) ok(`tarball has ${required}`);
    else fail(`tarball is missing ${required}`);
  }
  const wasmCount = [...paths].filter((p) => p.startsWith('dist/assets/') && p.endsWith('.wasm')).length;
  const scmCount = [...paths].filter((p) => p.startsWith('dist/assets/queries/') && p.endsWith('.scm')).length;
  if (wasmCount === 6) ok(`6 wasm files`);
  else fail(`expected 6 wasm files, found ${wasmCount}`);
  if (scmCount === 12) ok(`12 .scm queries`);
  else fail(`expected 12 .scm queries, found ${scmCount}`);
  const stray = [...paths].filter((p) => /^(src|dist\/(?!cli\.js$|assets\/))/.test(p) || p.endsWith('.map') || p.endsWith('.d.ts'));
  if (stray.length) fail(`unexpected files in tarball: ${stray.join(', ')}`);

  const manifestText = run('tar', ['-xOzf', tarball, 'package/package.json']);
  const manifest = JSON.parse(manifestText);
  process.stdout.write(`published dependencies: ${JSON.stringify(manifest.dependencies ?? {})}\n`);
  process.stdout.write(`published devDependencies: ${JSON.stringify(manifest.devDependencies ?? {})}\n`);
  if (manifestText.includes('workspace:')) fail('published manifest still contains a workspace: range');
  else ok('no workspace: ranges in the published manifest');
  const allDeps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.devDependencies };
  const internal = Object.keys(allDeps).filter((d) => d.startsWith('@testwitness/'));
  if (internal.length) fail(`published manifest references internal packages: ${internal.join(', ')}`);
  else ok('no @testwitness/* references in the published manifest');
  if (manifest.private) fail('published manifest is private');

  // 3. install into a fresh project with plain npm
  const proj = join(work, 'project');
  mkdirSync(proj);
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'pack-check-consumer', version: '0.0.0', private: true }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', tarball], { cwd: proj, env: cleanEnv });
  const bin = join(proj, 'node_modules', '.bin', 'testwitness');
  ok('npm install of the tarball');

  // 4a. --version
  const version = run(bin, ['--version'], { env: cleanEnv }).trim();
  process.stdout.write(`testwitness --version: ${version}\n`);
  if (version !== manifest.version) fail(`--version printed ${version}, manifest says ${manifest.version}`);
  else ok('--version matches the manifest');

  // 4b. check against a repo with weakened tests
  const repo = join(work, 'repo');
  makeWeakenedRepo(repo);
  const reportPath = join(work, 'report.json');
  const args = ['check', '--cwd', repo, '--base', 'main', '--head', 'HEAD', '--format', 'json', '--out', reportPath, '--mode', 'require-ack', '--fail-on', 'medium', '--quiet'];
  const res = spawnSync(bin, args, { encoding: 'utf8', env: cleanEnv });
  process.stdout.write(`testwitness check exit code: ${res.status}\n`);
  if (res.stderr.trim()) process.stdout.write(`stderr: ${res.stderr.trim()}\n`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const findings = report.findings ?? [];
  process.stdout.write(`report state: ${report.state}, findings: ${findings.length}\n`);
  for (const f of findings) process.stdout.write(`  ${f.ruleId} ${f.severity} ${f.location?.path}:${f.location?.line ?? ''} ${f.subject ?? ''}\n`);
  if (res.status !== 1) fail(`expected exit code 1 (review under require-ack), got ${res.status}`);
  else ok('check exit code 1');
  if (findings.length < 1) fail('expected at least one finding');
  const files = new Set(findings.map((f) => String(f.location?.path ?? '')));
  for (const ext of ['.ts', '.py', '.java']) {
    if ([...files].some((p) => p.endsWith(ext))) ok(`finding on a ${ext} test (grammar and queries load from the bundle)`);
    else fail(`no finding on the ${ext} test`);
  }

  // 4c. TESTWITNESS_ASSET_DIR is honoured: pointed at an empty dir, grammar loading must fail
  // (the engine logs the failure per file and drops the inventory, so no R001 findings remain).
  const empty = join(work, 'empty-assets');
  mkdirSync(empty);
  const res2 = spawnSync(bin, ['check', '--cwd', repo, '--base', 'main', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...cleanEnv, TESTWITNESS_ASSET_DIR: empty },
  });
  const r001 = res2.status === 0 ? JSON.parse(res2.stdout).findings.filter((f) => f.ruleId === 'R001').length : -1;
  if (res2.stderr.includes(empty) && r001 === 0) ok('TESTWITNESS_ASSET_DIR override is honoured');
  else fail(`TESTWITNESS_ASSET_DIR override ignored (exit ${res2.status}, R001 findings ${r001})`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (keep) process.stdout.write(`kept ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`\npack:check FAILED (${failures.length})\n`);
  process.exit(1);
}
process.stdout.write('\npack:check passed\n');

function makeWeakenedRepo(dir) {
  const git = (...a) => run('git', ['-c', 'user.name=pack-check', '-c', 'user.email=pack-check@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  mkdirSync(dir, { recursive: true });
  git('init', '-q', '-b', 'main');
  write('src/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
  write(
    'src/math.test.ts',
    [
      "import { describe, expect, it } from 'vitest';",
      "import { add } from './math';",
      '',
      "describe('add', () => {",
      "  it('adds two numbers', () => {",
      '    expect(add(1, 2)).toBe(3);',
      '  });',
      '',
      "  it('handles negatives', () => {",
      '    expect(add(-1, -2)).toBe(-3);',
      '  });',
      '});',
      '',
    ].join('\n'),
  );
  write(
    'tests/test_math.py',
    ['def test_add():', '    assert 1 + 2 == 3', '', '', 'def test_negatives():', '    assert -1 + -2 == -3', ''].join('\n'),
  );
  write(
    'src/test/java/MathTest.java',
    [
      'import org.junit.jupiter.api.Test;',
      'import static org.junit.jupiter.api.Assertions.assertEquals;',
      '',
      'class MathTest {',
      '  @Test',
      '  void adds() {',
      '    assertEquals(3, 1 + 2);',
      '  }',
      '',
      '  @Test',
      '  void negatives() {',
      '    assertEquals(-3, -1 + -2);',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'weaken');
  // Head: delete one test per language.
  write(
    'src/math.test.ts',
    ["import { describe, expect, it } from 'vitest';", "import { add } from './math';", '', "describe('add', () => {", "  it('adds two numbers', () => {", '    expect(add(1, 2)).toBe(3);', '  });', '});', ''].join('\n'),
  );
  write('tests/test_math.py', ['def test_add():', '    assert 1 + 2 == 3', ''].join('\n'));
  write(
    'src/test/java/MathTest.java',
    ['import org.junit.jupiter.api.Test;', 'import static org.junit.jupiter.api.Assertions.assertEquals;', '', 'class MathTest {', '  @Test', '  void adds() {', '    assertEquals(3, 1 + 2);', '  }', '}', ''].join('\n'),
  );
  git('commit', '-q', '-am', 'weaken tests');
}
