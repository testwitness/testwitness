// Security regressions that need a repository: hostile files in a pull request, seen through the whole check
// (docs/threat-model.md).
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, renderMarkdown, runEngine, type Rule } from '@testwitness/core';
import { check } from './check.js';
import { allFrontEnds } from './frontends.js';
import { readCounts, stateFile, writeCounts } from './hook/state.js';
import { main } from './index.js';
import { makeRepo, MATH_TEST_WEAKENED, type TestRepo } from './testing/repo.js';

let repo: TestRepo | undefined;
afterEach(() => {
  repo?.dispose();
  repo = undefined;
});

function branch(files: Record<string, string>, base: Record<string, string> = {}): TestRepo {
  repo = makeRepo(base);
  repo.git('checkout', '-q', '-b', 'pr');
  for (const [rel, text] of Object.entries(files)) repo.write(rel, text);
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'pr');
  return repo;
}

describe('a runner config a parser cannot read safely', () => {
  it('a YAML config of open brackets does not crash the check and is reported (high, capped at low in v0.1)', async () => {
    // Before the nesting check this aborted the process inside the YAML parser (exit code 134).
    const r = branch({ '.mocharc.yml': `spec: ${'['.repeat(200_000)}\n`, 'codecov.yml': `${'- '.repeat(5000)}x\n` }, { '.mocharc.yml': 'spec: test\n', 'codecov.yml': 'coverage:\n  status:\n    project:\n      default:\n        target: 80%\n' });
    const { report } = await check({ cwd: r.dir, base: 'main', head: 'HEAD', format: 'json', quiet: true, results: '' });
    const deep = report.findings.filter((f) => f.label === 'too deep');
    expect(deep.map((f) => [f.ruleId, f.severity, f.uncappedSeverity, f.location.path]).sort()).toEqual([
      ['C001', 'low', 'high', '.mocharc.yml'],
      ['C002', 'low', 'high', 'codecov.yml'],
    ]);
    expect(deep[0]!.message).toMatch(/nested deeper than 200 levels.*review it by hand/);
    expect(report.state).toBe('unreadable');
  }, 60_000);
});

describe('a rule or a parser that fails', () => {
  it('is named in the report instead of leaving only a log line', async () => {
    const r = branch({ 'src/math.test.ts': MATH_TEST_WEAKENED });
    const crashing: Rule = { id: 'X999', name: 'crashes', group: 'R', defaultSeverity: 'high', since: '0', languages: 'any', needs: ['diff'], docs: { summary: '', falsePositives: '', example: '' }, run: () => Promise.reject(new Error('boom')) };
    const logs: string[] = [];
    const { report } = await runEngine({ cwd: r.dir, base: 'main', head: 'HEAD', frontEnds: allFrontEnds(), config: defaultConfig(), rules: [crashing], evidence: undefined, log: (s) => logs.push(s) });
    expect(report.notes).toEqual(['Rule X999 failed on this change and reported nothing. That is a bug in testwitness; the other rules ran.']);
    expect(renderMarkdown(report)).toContain('Rule X999 failed on this change and reported nothing.');
    expect(logs.join('\n')).toMatch(/rule X999 failed: Error: boom/);
  });
});

describe('output files in a checkout the pull request controls', () => {
  it.skipIf(process.platform === 'win32')('--out does not write through a committed symbolic link', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'tw-victim-'));
    try {
      const victim = join(outside, 'authorized_keys');
      writeFileSync(victim, 'untouched');
      const r = branch({ 'src/math.test.ts': MATH_TEST_WEAKENED });
      symlinkSync(victim, join(r.dir, 'testwitness.md'));
      writeFileSync(join(r.dir, 'junit.xml'), '<testsuite><testcase classname="src/math.test.ts" name="add adds two numbers"/></testsuite>');
      const code = await main(['check', '--cwd', r.dir, '--base', 'main', '--format', 'markdown', '--out', 'testwitness.md', '--results', 'junit.xml', '--quiet']);
      expect(code).toBe(0);
      expect(readFileSync(victim, 'utf8')).toBe('untouched');
      expect(lstatSync(join(r.dir, 'testwitness.md')).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(r.dir, 'testwitness.md'), 'utf8')).toContain('## testwitness: review');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('hostile names all the way through', () => {
  it.skipIf(process.platform === 'win32')('a test file whose name and tests hold line breaks, pipes, mentions and escape codes stays inside its table row', async () => {
    const name = 'src/a|b`c @octocat\n| R999 | high | `x` | forged.test.ts';
    const body = "import { expect, it } from 'vitest';\nit('first @octocat https://evil.test \\u001b[31m | x', () => { expect(1).toBe(1); });\nit('second', () => { expect(2).toBe(2); });\n";
    const r = branch({ [name]: body.replace("it('second', () => { expect(2).toBe(2); });\n", '') }, { [name]: body });
    const { report } = await check({ cwd: r.dir, base: 'main', head: 'HEAD', format: 'json', quiet: true, results: '' });
    expect(report.findings.some((f) => f.location.path === name)).toBe(true);
    const md = renderMarkdown(report);
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Rule') && !l.startsWith('|---'));
    expect(rows.length).toBe(report.findings.filter((f) => !f.acknowledged).length);
    // The path is shown in a code span, where GitHub links nothing and notifies nobody; everything else is escaped.
    const outsideCode = md.replace(/`[^`\n]*`/g, '');
    expect(outsideCode).not.toContain('@');
    expect(outsideCode).not.toMatch(/https?:\/\//);
    expect(md).not.toMatch(/^\| R999 /m);
    for (const row of rows) expect(row.match(/(?<!\\)\|/g)).toHaveLength(5);
  });
});

describe('the loop guard state directory', () => {
  it.skipIf(process.platform === 'win32')('is not used when group or others can write to it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-state-'));
    try {
      expect(writeCounts(dir, '/repo', 's', { a: 1 })).toBe(true);
      expect(readCounts(dir, '/repo', 's')).toEqual({ a: 1 });
      chmodSync(dir, 0o777);
      expect(writeCounts(dir, '/repo', 's', { a: 2 })).toBe(false);
      expect(readCounts(dir, '/repo', 's')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('is not used when it is a symbolic link, and ignores state that is not counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-state-'));
    try {
      const link = join(dir, 'link');
      symlinkSync(dir, link);
      expect(writeCounts(link, '/repo', 's', { a: 1 })).toBe(false);
      expect(existsSync(join(dir, 'x'))).toBe(false);
      expect(writeCounts(dir, '/repo', 's', { a: 1 })).toBe(true);
      for (const junk of ['not json', '[]', '{"blocks":"x"}', '{"blocks":{"a":"9","b":null,"__proto__":{"polluted":1}}}']) {
        writeFileSync(stateFile(dir, '/repo', 's'), junk);
        expect(readCounts(dir, '/repo', 's')).toEqual({});
      }
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
