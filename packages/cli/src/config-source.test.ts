// Security regression: a config that is part of the change being judged is never read (docs/threat-model.md, "Config").
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, loadConfig } from './check.js';
import { makeRepo, MATH_TEST_WEAKENED, type TestRepo } from './testing/repo.js';

const ALL_OFF = 'rules:\n  W006: off\n  R003: off\n  A002: off\n  R004: off\n  A001: off\n';
const rulesOf = (r: { report: { findings: Array<{ ruleId: string }> } }): string[] => r.report.findings.map((f) => f.ruleId);

describe('where the config comes from', () => {
  let repo: TestRepo | undefined;
  afterEach(() => {
    repo?.dispose();
    repo = undefined;
  });

  /** A repository without a config on main, and a branch that weakens a test and adds a config turning the rules off. */
  function prAddsConfig(): TestRepo {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.write('.testwitness.yml', ALL_OFF);
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'weaken and configure');
    return repo;
  }

  it('a pull request that adds .testwitness.yml to a repository without one cannot switch the rules off (CLI default)', async () => {
    const r = prAddsConfig();
    const logs: string[] = [];
    const out = await check({ cwd: r.dir, base: 'main', head: 'HEAD', format: 'json', results: '', log: (s) => logs.push(s) });
    expect(rulesOf(out)).toEqual(expect.arrayContaining(['A002', 'R003', 'W006']));
    expect(out.report.state).toBe('review');
    expect(logs.join('\n')).toMatch(/\.testwitness\.yml is not on the base branch and is part of the change/);
  });

  it('the same holds with configFromBaseOnly, which the Action, the hook and the MCP server set', async () => {
    const r = prAddsConfig();
    const out = await check({ cwd: r.dir, base: 'main', head: 'HEAD', format: 'json', quiet: true, results: '', configFromBaseOnly: true });
    expect(rulesOf(out)).toEqual(expect.arrayContaining(['A002', 'R003', 'W006']));
  });

  it('working tree mode never reads a working tree config the base does not have', async () => {
    repo = makeRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.write('.testwitness.yml', ALL_OFF);
    const out = await check({ cwd: repo.dir, base: 'main', head: 'HEAD', worktree: true, format: 'json', quiet: true, results: '' });
    expect(rulesOf(out)).toEqual(expect.arrayContaining(['A002', 'R003', 'W006']));
  });

  it('a local, uncommitted config is still read when commits are compared: it is not part of the change', async () => {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.git('commit', '-q', '-am', 'weaken');
    repo.write('.testwitness.yml', 'mode: strict\n');
    const cfg = await loadConfig({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json' });
    expect(cfg.mode).toBe('strict');
  });

  it('the config at the merge base wins over the copy the pull request changed', async () => {
    repo = makeRepo({ '.testwitness.yml': 'mode: strict\n' });
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('.testwitness.yml', `mode: report\n${ALL_OFF}`);
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.git('commit', '-q', '-am', 'relax');
    const out = await check({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json', quiet: true, results: '' });
    expect(out.config.mode).toBe('strict');
    expect(rulesOf(out)).toEqual(expect.arrayContaining(['A002', 'W006']));
  });

  it('with configFromBaseOnly an explicit config path inside the repository is read at the merge base, not from the checkout', async () => {
    repo = makeRepo({ 'ci/tw.yml': 'mode: strict\n' });
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('ci/tw.yml', `mode: report\n${ALL_OFF}`);
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.git('commit', '-q', '-am', 'relax');
    const base = await loadConfig({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json', config: 'ci/tw.yml', configFromBaseOnly: true });
    expect(base.mode).toBe('strict');
    expect(base.rules['A002']).toBeUndefined();
    // Without the flag the path is the operator's choice (a local run) and is read from disk.
    const disk = await loadConfig({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json', config: 'ci/tw.yml' });
    expect(disk.mode).toBe('report');
  });

  it('with configFromBaseOnly a config path the pull request adds gives the defaults, and one outside the repository is read from disk', async () => {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('ci/tw.yml', ALL_OFF);
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'add config');
    const added = await loadConfig({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json', config: 'ci/tw.yml', configFromBaseOnly: true });
    expect(added.rules).toEqual({});
    const outside = mkdtempSync(join(tmpdir(), 'tw-cfg-'));
    try {
      writeFileSync(join(outside, 'tw.yml'), 'mode: require-ack\n');
      const cfg = await loadConfig({ cwd: repo.dir, base: 'main', head: 'HEAD', format: 'json', config: join(outside, 'tw.yml'), configFromBaseOnly: true });
      expect(cfg.mode).toBe('require-ack');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
