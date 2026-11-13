// Prove the published `testwitness` package works on its own, outside the workspace.
//
//   1. bundle the CLI (scripts/bundle-cli.mjs)
//   2. pnpm pack it into a temp dir and check the tarball manifest is clean
//   3. npm install the tarball into a fresh temp project (no workspace)
//   4. run `testwitness --version`, `testwitness check` on a temp git repo whose head
//      weakens a TypeScript, a Python and a Java test (require findings), and `testwitness mcp` (require its tools),
//      then --coverage, --mutation (a real StrykerJS report from the golden fixtures), mutate-plan, the run history,
//      and --results with real Node TAP (and --junit, its older name)
//
// Exits non zero on any failure. Used by the release workflow before publish.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
// The node binary that runs the installed CLI. Defaults to the current node; CI points it at
// an older Node to prove the published package still runs there while pnpm stays on Node 22.
const cliNode = process.env.PACK_CHECK_NODE || process.execPath;
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

  // Extract the tarball and stat the files. Parsing `tar -tv` output is not portable:
  // GNU tar and macOS bsdtar print different columns.
  const extractDir = join(work, 'extract');
  mkdirSync(extractDir);
  run('tar', ['-xzf', tarball, '-C', extractDir]);
  const listing = walk(extractDir).map((abs) => ({ size: statSync(abs).size, path: relative(extractDir, abs).split(sep).join('/') }));
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
  // npm 11 drops a bin entry whose path starts with ./ ("script name was invalid and removed"),
  // which would publish a package with no testwitness command.
  const binPath = manifest.bin?.testwitness;
  if (typeof binPath === 'string' && /^bin\/[A-Za-z0-9._-]+\.js$/.test(binPath)) ok(`bin path is ${binPath}`);
  else fail(`bin.testwitness is ${JSON.stringify(binPath)}, expected a plain bin/<name>.js path`);

  // 3. install into a fresh project with plain npm
  const proj = join(work, 'project');
  mkdirSync(proj);
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'pack-check-consumer', version: '0.0.0', private: true }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', tarball], { cwd: proj, env: cleanEnv });
  const binJs = join(proj, 'node_modules', 'testwitness', 'bin', 'testwitness.js');
  const bin = cliNode;
  const cli = (args, opts = {}) => run(bin, [binJs, ...args], opts);
  ok('npm install of the tarball');
  if (statSync(join(proj, 'node_modules', '.bin', 'testwitness'), { throwIfNoEntry: false })) ok('npm linked the testwitness command');
  else fail('npm did not link node_modules/.bin/testwitness (bin entry missing from the published manifest)');
  process.stdout.write(`CLI runs on node ${run(bin, ['-v']).trim()} (${bin})\n`);

  // 4a. --version
  const version = cli(['--version'], { env: cleanEnv }).trim();
  process.stdout.write(`testwitness --version: ${version}\n`);
  if (version !== manifest.version) fail(`--version printed ${version}, manifest says ${manifest.version}`);
  else ok('--version matches the manifest');

  // 4b. check against a repo with weakened tests
  const repo = join(work, 'repo');
  makeWeakenedRepo(repo);
  const reportPath = join(work, 'report.json');
  const args = ['check', '--cwd', repo, '--base', 'main', '--head', 'HEAD', '--format', 'json', '--out', reportPath, '--mode', 'require-ack', '--fail-on', 'medium', '--quiet'];
  const res = spawnSync(bin, [binJs, ...args], { encoding: 'utf8', env: cleanEnv });
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
  const res2 = spawnSync(bin, [binJs, 'check', '--cwd', repo, '--base', 'main', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...cleanEnv, TESTWITNESS_ASSET_DIR: empty },
  });
  const r001 = res2.status === 0 ? JSON.parse(res2.stdout).findings.filter((f) => f.ruleId === 'R001').length : -1;
  if (res2.stderr.includes(empty) && r001 === 0) ok('TESTWITNESS_ASSET_DIR override is honoured');
  else fail(`TESTWITNESS_ASSET_DIR override ignored (exit ${res2.status}, R001 findings ${r001})`);

  // 4d. the MCP server answers initialize and tools/list over stdio from the bundle
  const rpc = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-check', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  const mcp = spawnSync(bin, [binJs, 'mcp'], { input: rpc.map((m) => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', env: cleanEnv, timeout: 30_000 });
  const replies = mcp.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tools = (replies.find((r) => r.id === 2)?.result?.tools ?? []).map((t) => t.name).sort();
  process.stdout.write(`testwitness mcp tools: ${tools.join(', ')}\n`);
  if (tools.join(',') === 'testwitness_check,testwitness_explain_rule,testwitness_rules') ok('mcp server lists its three tools');
  else fail(`mcp server tools/list returned ${JSON.stringify(tools)} (exit ${mcp.status}, stderr ${mcp.stderr.trim()})`);

  // 4d2. the agent guard from the installed package: check --worktree, hook, init and a real refused git push
  for (const required of ['plugin/.claude-plugin/plugin.json', 'plugin/hooks/hooks.json', 'plugin/.mcp.json']) {
    if (paths.has(required)) ok(`tarball has ${required}`);
    else fail(`tarball is missing ${required}`);
  }
  const guardRepo = join(work, 'guard-repo');
  makeWeakenedRepo(guardRepo);
  const guardGit = (dir, ...a) => run('git', ['-c', 'user.name=pack', '-c', 'user.email=pack@testwitness.local', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
  guardGit(guardRepo, 'checkout', '-q', 'main');
  // The agent loosens an assertion: toBe(3) becomes toBeDefined(), an A002 finding at high.
  const loosened = readFileSync(join(guardRepo, 'src/math.test.ts'), 'utf8').replace('expect(add(1, 2)).toBe(3);', 'expect(add(1, 2)).toBeDefined();');
  writeFileSync(join(guardRepo, 'src/math.test.ts'), loosened);
  const hookTmp = join(work, 'hook-tmp');
  mkdirSync(hookTmp);
  const hookEnv = { ...cleanEnv, TMPDIR: hookTmp, TMP: hookTmp, TEMP: hookTmp };
  const before = guardGit(guardRepo, 'status', '--porcelain=v1', '-uall') + guardGit(guardRepo, 'count-objects', '-v');
  const wt = JSON.parse(cli(['check', '--worktree', '--cwd', guardRepo, '--base', 'main', '--format', 'json', '--results', '', '--quiet'], { env: hookEnv }));
  if (wt.headTree && wt.findings.some((f) => f.ruleId === 'A002' && f.severity === 'high')) ok('check --worktree reports the loosened assertion and carries headTree');
  else fail(`check --worktree: headTree ${wt.headTree}, findings ${wt.findings.map((f) => f.ruleId).join(',')}`);
  const stopEvent = JSON.stringify({ session_id: 'pack-check', cwd: guardRepo, hook_event_name: 'Stop', stop_hook_active: false });
  const stop = spawnSync(bin, [binJs, 'hook', '--agent', 'claude'], { input: stopEvent, encoding: 'utf8', env: hookEnv, timeout: 30_000 });
  let stopOut = {};
  try {
    stopOut = JSON.parse(stop.stdout);
  } catch {
    /* reported below */
  }
  if (stop.status === 0 && stopOut.decision === 'block' && /A002 high src\/math\.test\.ts:\d+/.test(stopOut.reason ?? '') && /expect\(add\(1, 2\)\)\.toBe\(3\);/.test(stopOut.reason ?? '')) ok('hook --agent claude blocks the Stop event with the rule, the file and the base text');
  else fail(`hook --agent claude on Stop: exit ${stop.status}, stdout ${stop.stdout.slice(0, 300)}, stderr ${stop.stderr.slice(0, 300)}`);
  const noise = spawnSync(bin, [binJs, 'hook', '--agent', 'claude'], { input: JSON.stringify({ session_id: 'pack-check', cwd: guardRepo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }), encoding: 'utf8', env: hookEnv, timeout: 30_000 });
  if (noise.status === 0 && noise.stdout === '') ok('hook --agent claude says nothing on an unrelated Bash command');
  else fail(`hook on npm test: exit ${noise.status}, stdout ${noise.stdout.slice(0, 200)}`);
  const broken = spawnSync(bin, [binJs, 'hook', '--agent', 'cursor'], { input: 'not json', encoding: 'utf8', env: hookEnv, timeout: 30_000 });
  if (broken.status === 0 && /"permission":"allow"/.test(broken.stdout) && /allowed without a check/.test(broken.stdout)) ok('hook allows and says so when the event is unreadable');
  else fail(`hook on unreadable stdin: exit ${broken.status}, stdout ${broken.stdout.slice(0, 200)}`);
  const after = guardGit(guardRepo, 'status', '--porcelain=v1', '-uall') + guardGit(guardRepo, 'count-objects', '-v');
  if (before === after) ok('the working tree check and the hook left the repository untouched');
  else fail('the repository changed during check --worktree or the hook');
  const init1 = cli(['init', '--agent', 'claude', '--cwd', guardRepo, '--command', 'testwitness'], { env: hookEnv });
  const init2 = cli(['init', '--agent', 'claude', '--cwd', guardRepo, '--command', 'testwitness'], { env: hookEnv });
  const settings = JSON.parse(readFileSync(join(guardRepo, '.claude/settings.json'), 'utf8'));
  if (/^created \.claude\/settings\.json/.test(init1) && /^unchanged \.claude\/settings\.json/.test(init2) && settings.hooks?.Stop?.[0]?.hooks?.[0]?.command === 'testwitness hook --agent claude') ok('init --agent claude writes .claude/settings.json and is idempotent');
  else fail(`init --agent claude: ${init1.trim()} / ${init2.trim()}`);
  // A real push through the installed pre-push hook: the pushed commit loosens an assertion, so git must refuse it.
  const remote = join(work, 'remote.git');
  run('git', ['init', '-q', '--bare', remote]);
  guardGit(guardRepo, 'remote', 'add', 'origin', remote);
  guardGit(guardRepo, 'push', '-q', 'origin', 'main');
  cli(['init', '--agent', 'git', '--cwd', guardRepo, '--command', `"${bin}" "${binJs}"`], { env: hookEnv });
  guardGit(guardRepo, 'checkout', '-q', '-b', 'agent-work');
  guardGit(guardRepo, 'add', '-A', 'src');
  guardGit(guardRepo, 'commit', '-q', '-m', 'make the suite green');
  const push = spawnSync('git', ['push', 'origin', 'agent-work'], { cwd: guardRepo, encoding: 'utf8', env: hookEnv, timeout: 60_000 });
  const pushed = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/agent-work'], { cwd: remote, encoding: 'utf8' }).status === 0;
  if (push.status !== 0 && !pushed && /testwitness blocked this push/.test(push.stderr) && /A002 high src\/math\.test\.ts/.test(push.stderr)) ok('git push is refused by the pre-push hook init --agent git installed');
  else fail(`git push through the pre-push hook: exit ${push.status}, reached the remote ${pushed}, stderr ${push.stderr.slice(0, 400)}`);

  // 4e. --coverage reads an lcov report and V008 reports a changed production line it never executed
  const gitIn = (...a) => run('git', ['-c', 'user.name=pack-check', '-c', 'user.email=pack-check@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: repo });
  writeFileSync(join(repo, 'src/math.ts'), 'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) =>\n  a - b;\n');
  gitIn('commit', '-q', '-am', 'add sub');
  writeFileSync(join(work, 'lcov.info'), 'SF:src/math.ts\nDA:1,3\nDA:2,0\nDA:3,0\nend_of_record\n');
  const cov = spawnSync(bin, [binJs, 'check', '--cwd', repo, '--base', 'main', '--format', 'json', '--coverage', join(work, 'lcov.info'), '--quiet'], { encoding: 'utf8', env: cleanEnv });
  const covReport = cov.status === 0 ? JSON.parse(cov.stdout) : undefined;
  const v008 = covReport?.findings.find((f) => f.ruleId === 'V008');
  if (v008 && covReport.coverage?.files === 1 && covReport.coverage.linesInstrumented === 3) ok(`--coverage read the lcov report and V008 reported: ${v008.message}`);
  else fail(`--coverage did not produce V008 and a coverage section (exit ${cov.status}, stderr ${cov.stderr.trim()})`);

  // 4f. --mutation reads a real StrykerJS report (the golden fixture's) and M001 reports the changed lines whose mutants survived
  const mutCase = join(root, 'fixtures/ts-vitest/cases/M001-survivors-on-changed-lines');
  writeFileSync(join(repo, 'src/shipping.ts'), readFileSync(join(mutCase, 'head/src/shipping.ts'), 'utf8'));
  gitIn('add', '-A');
  gitIn('commit', '-q', '-m', 'shipping fee');
  const mut = spawnSync(bin, [binJs, 'check', '--cwd', repo, '--base', 'main', '--format', 'json', '--mutation', join(mutCase, 'mutation/mutation.json'), '--quiet'], { encoding: 'utf8', env: cleanEnv });
  const mutReport = mut.status === 0 ? JSON.parse(mut.stdout) : undefined;
  const m001 = mutReport?.findings.find((f) => f.ruleId === 'M001');
  if (m001?.label === 'measured weak' && m001.location?.path === 'src/shipping.ts' && mutReport.mutation?.mutants === 18) ok(`--mutation read the Stryker report and M001 reported: ${m001.message}`);
  else fail(`--mutation did not produce M001 and a mutation section (exit ${mut.status}, stderr ${mut.stderr.trim()})`);
  const plan = spawnSync(bin, [binJs, 'mutate-plan', '--cwd', repo, '--base', 'main', '--head', 'HEAD', '--format', 'json'], { encoding: 'utf8', env: cleanEnv });
  const planJson = plan.status === 0 ? JSON.parse(plan.stdout) : undefined;
  if (planJson?.stryker?.mutate?.includes('src/shipping.ts:1-10')) ok(`mutate-plan planned ${planJson.stryker.mutate.join(', ')}`);
  else fail(`mutate-plan did not plan src/shipping.ts (exit ${plan.status}, stderr ${plan.stderr.trim()})`);

  // 4g. --history-out writes a run history and --history reads it back
  writeFileSync(join(work, 'junit.xml'), '<testsuite name="s"><testcase classname="tests.test_math" name="test_adds"/><testcase classname="tests.test_math" name="test_negatives"><failure/></testcase></testsuite>');
  const historyPath = join(work, 'history.json');
  const hist = (id, extra) => spawnSync(bin, [binJs, 'check', '--cwd', repo, '--base', 'main', '--format', 'json', '--junit', join(work, 'junit.xml'), '--run-id', id, '--history-out', historyPath, ...extra, '--quiet'], { encoding: 'utf8', env: cleanEnv });
  hist('1', []);
  const h2 = hist('2', ['--history', historyPath]);
  const h2Report = h2.status === 0 ? JSON.parse(h2.stdout) : undefined;
  const histDoc = JSON.parse(readFileSync(historyPath, 'utf8'));
  if (histDoc.runs?.length === 2 && histDoc.tests?.['test_math::test_negatives'] === 'FF' && h2Report?.history?.runs === 1) ok('--history-out wrote 2 runs and --history read them back');
  else fail(`run history round trip failed (exit ${h2.status}, stderr ${h2.stderr.trim()}, runs ${histDoc.runs?.length})`);

  // 4h. --results reads real TAP from Node's test runner (the ts-node-test golden pair): the derived file that lacks a
  // modified test gives V003, and the real file read through the older --junit name gives none.
  const tapCase = (name) => join(root, 'fixtures/ts-node-test/cases', name);
  const tapRepo = join(work, 'tap-repo');
  mkdirSync(tapRepo);
  const gitTap = (...a) => run('git', ['-c', 'user.name=pack-check', '-c', 'user.email=pack-check@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: tapRepo });
  gitTap('init', '-q', '-b', 'main');
  for (const side of ['base', 'head']) {
    for (const f of readdirSync(join(tapCase('V003-tap-modified-test-missing'), side, 'test'))) {
      mkdirSync(join(tapRepo, 'test'), { recursive: true });
      writeFileSync(join(tapRepo, 'test', f), readFileSync(join(tapCase('V003-tap-modified-test-missing'), side, 'test', f)));
    }
    gitTap('add', '-A');
    gitTap('commit', '-q', '-m', side);
    if (side === 'base') gitTap('checkout', '-q', '-b', 'change');
  }
  const tapCheck = (flag, file) => {
    const r = spawnSync(bin, [binJs, 'check', '--cwd', tapRepo, '--base', 'main', '--format', 'json', flag, file, '--quiet'], { encoding: 'utf8', env: cleanEnv });
    return r.status === 0 ? JSON.parse(r.stdout) : { error: `exit ${r.status}, stderr ${r.stderr.trim()}` };
  };
  const tapMissing = tapCheck('--results', join(tapCase('V003-tap-modified-test-missing'), 'results/results.tap'));
  const v003 = tapMissing.findings?.find((f) => f.ruleId === 'V003');
  if (v003?.severity === 'high' && tapMissing.evidence?.formats?.join() === 'tap' && tapMissing.evidence.total === 12) ok(`--results read Node TAP and V003 reported: ${v003.message}`);
  else fail(`--results with TAP did not give V003 and evidence.formats [tap]: ${JSON.stringify(tapMissing.error ?? tapMissing.evidence)}`);
  const tapAll = tapCheck('--junit', join(tapCase('V003-tap-all-changed-tests-ran'), 'results/results.tap'));
  if (tapAll.evidence?.formats?.join() === 'tap' && tapAll.evidence.total === 13 && !tapAll.findings?.some((f) => f.ruleId === 'V003')) ok('--junit, the older name, reads the same TAP and every changed test has a record');
  else fail(`--junit with TAP did not read 13 tests without V003: ${JSON.stringify(tapAll.error ?? tapAll.evidence)}`);
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

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

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
