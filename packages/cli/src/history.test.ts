import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistory } from '@testwitness/core';
import { check } from './check.js';
import { TMP } from './testing/repo.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Maple Ridge', GIT_AUTHOR_EMAIL: 'maple@example.test', GIT_COMMITTER_NAME: 'Maple Ridge', GIT_COMMITTER_EMAIL: 'maple@example.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim();

const BASE = `def test_totals():\n    assert 1 + 1 == 2\n\n\ndef test_refunds():\n    assert 2 - 1 == 1\n`;
const HEAD = BASE.replace('def test_refunds', 'import pytest\n\n\n@pytest.mark.skip\ndef test_refunds');
const XML = (refunds: 'pass' | 'fail') =>
  `<testsuites><testsuite name="pytest"><testcase classname="tests.test_cart" name="test_totals"/><testcase classname="tests.test_cart" name="test_refunds">${refunds === 'fail' ? '<failure message="x"/>' : ''}</testcase></testsuite></testsuites>`;

/** A repo whose head skips test_refunds. */
function repo(): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(TMP, 'tw-cli-history-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests/test_cart.py'), BASE);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'tests/test_cart.py'), HEAD);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'skip refunds');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
}

describe('CLI run history', () => {
  it('builds a history run by run with --history-out and grades the skip of a test that kept failing as hides failure', async () => {
    const r = repo();
    try {
      const run = (id: string, xml: string, withHistory: boolean) => {
        writeFileSync(join(r.dir, 'junit.xml'), xml);
        return check({ cwd: r.dir, base: r.base, head: r.base, junit: 'junit.xml', format: 'json', quiet: true, runId: id, historyOut: 'out/history.json', ...(withHistory ? { history: 'out/history.json' } : {}) });
      };
      await run('1', XML('pass'), false);
      await run('2', XML('fail'), true);
      await run('3', XML('fail'), true);
      const doc = parseHistory(readFileSync(join(r.dir, 'out/history.json'), 'utf8')).doc!;
      expect(doc.runs.map((x) => x.id)).toEqual(['1', '2', '3']);
      expect(doc.tests['test_cart::test_refunds']).toBe('PFF');

      const without = await check({ cwd: r.dir, base: r.base, head: r.head, format: 'json', junit: 'none/*.xml', quiet: true });
      expect(without.report.findings.find((f) => f.ruleId === 'R003')).toMatchObject({ severity: 'medium' });
      expect(without.report.history).toBeUndefined();
      expect(without.history).toBeUndefined();

      const graded = await check({ cwd: r.dir, base: r.base, head: r.head, format: 'json', junit: 'none/*.xml', quiet: true, history: 'out/history.json' });
      const f = graded.report.findings.find((x) => x.ruleId === 'R003')!;
      expect(f).toMatchObject({ severity: 'high', label: 'hides failure' });
      expect(f.message).toMatch(/failed in 2 of the last 3 runs$/);
      expect(graded.report.history).toEqual({ source: 'out/history.json', runs: 3, tests: 2, adjusted: 1, notes: [] });
      // Same fingerprint with and without history, so acknowledgements keep matching.
      expect(f.fingerprint).toBe(without.report.findings.find((x) => x.ruleId === 'R003')!.fingerprint);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('notes an unreadable history in the report and grades without it; writes nothing without --history-out', async () => {
    const r = repo();
    try {
      writeFileSync(join(r.dir, 'broken.json'), '{"schemaVersion":"2"}');
      const res = await check({ cwd: r.dir, base: r.base, head: r.head, format: 'json', junit: 'none/*.xml', quiet: true, history: 'broken.json' });
      expect(res.report.history).toMatchObject({ source: 'broken.json', runs: 0, tests: 0, adjusted: 0 });
      expect(res.report.history!.notes[0]).toMatch(/schemaVersion "2" is not supported.*severities do not use history/);
      expect(res.report.findings.find((f) => f.ruleId === 'R003')).toMatchObject({ severity: 'medium' });
      const missing = await check({ cwd: r.dir, base: r.base, head: r.head, format: 'json', junit: 'none/*.xml', quiet: true, history: 'nope.json' });
      expect(missing.report.history!.notes[0]).toMatch(/does not exist/);
      expect(existsSync(join(r.dir, 'out'))).toBe(false);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }, 60_000);
});
