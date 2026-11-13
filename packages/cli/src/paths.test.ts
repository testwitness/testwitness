// Paths and globs that cross the CLI boundary. The Windows logic is a pure function of its platform argument, so these
// tests run it on every runner; the integration tests at the end use the runner's own paths and pass on all three.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import fg from 'fast-glob';
import { mergeHistory, serializeHistory } from '@testwitness/core';
import { check, globBase, pathToPattern, splitGlobs, windowsGlobToPattern } from './check.js';

describe('splitGlobs', () => {
  it('splits on commas and trims, and leaves POSIX globs alone on every platform', () => {
    expect(splitGlobs(' a/**/*.xml , ,b/*.json ', 'linux')).toEqual(['a/**/*.xml', 'b/*.json']);
    // Brackets stay glob syntax without backslashes, also on Windows.
    expect(splitGlobs('out/[ab]/*.xml', 'win32')).toEqual(['out/[ab]/*.xml']);
    expect(splitGlobs('out/[ab]/*.xml', 'linux')).toEqual(['out/[ab]/*.xml']);
    // On POSIX a backslash is an escape, never a separator.
    expect(splitGlobs('out/x\\[1\\]/*.xml', 'darwin')).toEqual(['out/x\\[1\\]/*.xml']);
  });

  it('converts Windows paths: backslashes, drive letters, UNC shares', () => {
    expect(splitGlobs('test-results\\**\\*.xml', 'win32')).toEqual(['test-results/**/*.xml']);
    expect(splitGlobs('C:\\a\\repo\\out\\*.xml,D:\\cov\\lcov.info', 'win32')).toEqual(['C:/a/repo/out/*.xml', 'D:/cov/lcov.info']);
    expect(splitGlobs('\\\\build\\share\\results\\**\\*.xml', 'win32')).toEqual(['//build/share/results/**/*.xml']);
  });

  it('keeps brackets, braces and parentheses of a Windows path literal, and the separator before them', () => {
    // fast-glob's convertPathToPattern read `\[` as an escape and lost the separator: `app[id]` instead of `app/[id]`.
    expect(splitGlobs('C:\\app\\[id]\\*.xml', 'win32')).toEqual(['C:/app/\\[id\\]/*.xml']);
    expect(splitGlobs('C:\\Program Files (x86)\\r\\*.xml', 'win32')).toEqual(['C:/Program Files \\(x86\\)/r/*.xml']);
    expect(splitGlobs('C:\\r\\{v2}\\*.xml', 'win32')).toEqual(['C:/r/\\{v2\\}/*.xml']);
  });
});

describe('windowsGlobToPattern', () => {
  it('gives a pattern fast-glob matches against the literal directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-winglob-'));
    try {
      mkdirSync(join(dir, 'out', '[id]', '(x)'), { recursive: true });
      writeFileSync(join(dir, 'out', '[id]', '(x)', 'a.xml'), '');
      // What the old conversion matched: the separator before [id] lost, the directory out[id].
      mkdirSync(join(dir, 'out[id]', '(x)'), { recursive: true });
      writeFileSync(join(dir, 'out[id]', '(x)', 'wrong.xml'), '');
      const p = windowsGlobToPattern('out\\[id]\\(x)\\*.xml');
      expect(p).toBe('out/\\[id\\]/\\(x\\)/*.xml');
      expect(fg.globSync(p, { cwd: dir })).toEqual(['out/[id]/(x)/a.xml']);
      expect(globBase(p)).toBe('out/[id]/(x)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('escapes a leading ! so a path is never read as a negated pattern', () => {
    expect(windowsGlobToPattern('!out\\a.xml')).toBe('\\!out/a.xml');
  });
});

describe('pathToPattern', () => {
  it('converts a Windows history path on any platform', () => {
    expect(pathToPattern('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\testwitness-history-x1\\history.json', 'win32')).toBe('C:/Users/RUNNER~1/AppData/Local/Temp/testwitness-history-x1/history.json');
    expect(pathToPattern('\\\\srv\\share\\h [1]\\history.json', 'win32')).toBe('//srv/share/h \\[1\\]/history.json');
    expect(pathToPattern('out\\history.json', 'win32')).toBe('out/history.json');
  });

  it('escapes glob characters of a POSIX path', () => {
    expect(pathToPattern('/tmp/h [1] (x)/history.json', 'linux')).toBe('/tmp/h \\[1\\] \\(x\\)/history.json');
    expect(pathToPattern('out/history.json', 'linux')).toBe('out/history.json');
  });
});

describe('globBase', () => {
  it('is the leading literal part of a pattern, unescaped', () => {
    expect(globBase('**/*.xml')).toBe('.');
    expect(globBase('test-results/**/*.xml')).toBe('test-results');
    expect(globBase('/tmp/h \\[1\\]/history.json')).toBe('/tmp/h [1]/history.json');
    expect(globBase('C:/app/\\[id\\]/*.xml')).toBe('C:/app/[id]');
    expect(globBase('//srv/share/r/**/*.xml')).toBe('//srv/share/r');
    expect(globBase('out/[ab]/*.xml')).toBe('out');
  });
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

/** A repository whose head skips a test in a nested directory, at `dir`. */
function repoAt(dir: string, eol: '\n' | '\r\n' = '\n'): { base: string; head: string } {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: ENV }).trim();
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  const body = 'def test_totals():\n    assert 1 + 1 == 2\n\n\ndef test_refunds():\n    assert 2 - 1 == 1\n';
  writeFileSync(join(dir, 'tests', 'unit', 'test_cart.py'), body.replace(/\n/g, eol));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'tests', 'unit', 'test_cart.py'), body.replace('def test_refunds', 'import pytest\n\n\n@pytest.mark.skip\ndef test_refunds').replace(/\n/g, eol));
  git('add', '-A');
  git('commit', '-q', '-m', 'skip');
  return { base, head: git('rev-parse', 'HEAD') };
}

describe('paths across platforms, end to end', () => {
  it('reads a history outside the repository from a directory whose name has brackets, parentheses and spaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tw-paths-'));
    try {
      const repo = join(root, 'repo');
      mkdirSync(repo);
      const r = repoAt(repo);
      const histDir = join(root, 'history [run 1] (base)');
      mkdirSync(histDir);
      const history = join(histDir, 'history.json');
      const failed = [{ key: 'test_cart::test_refunds', status: 'failed' as const, reruns: 0 }];
      writeFileSync(history, serializeHistory(mergeHistory(mergeHistory(undefined, { id: '1', date: '2026-11-01' }, failed), { id: '2', date: '2026-11-02' }, failed)));
      const notes: string[] = [];
      // Native absolute path, as the Action passes the history it downloads to the temp directory.
      const { report } = await check({ cwd: repo, base: r.base, head: r.head, junit: 'none/*.xml', format: 'json', quiet: true, history, log: (s) => notes.push(s) });
      expect(notes.join('\n')).not.toMatch(/symbolic link or outside the repository/);
      expect(report.history).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gives the same fingerprints and forward slash paths whatever the checkout path and line endings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tw-fp-'));
    try {
      const run = async (name: string, eol: '\n' | '\r\n') => {
        const dir = join(root, name);
        mkdirSync(dir);
        const r = repoAt(dir, eol);
        return (await check({ cwd: dir, base: r.base, head: r.head, junit: 'none/*.xml', format: 'json', quiet: true })).report.findings;
      };
      const plain = await run('a', '\n');
      const odd = await run('b [x] (y) z', '\n');
      const windows = await run('c', '\r\n');
      const r003 = plain.find((f) => f.ruleId === 'R003')!;
      expect(r003.location.path).toBe('tests/unit/test_cart.py');
      expect(r003.fingerprint).toContain('tests/unit/test_cart.py');
      if (sep === '\\') expect(r003.fingerprint).not.toContain('\\');
      const fps = (fs: typeof plain) => fs.map((f) => [f.ruleId, f.location, f.fingerprint]);
      expect(fps(odd)).toEqual(fps(plain));
      expect(fps(windows)).toEqual(fps(plain));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'win32')('matches results through a path.join glob into a directory with brackets on Windows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tw-win-glob-'));
    try {
      const repo = join(root, 'repo');
      mkdirSync(repo);
      const r = repoAt(repo);
      mkdirSync(join(repo, 'out [1]'));
      writeFileSync(join(repo, 'out [1]', 'junit.xml'), '<testsuite name="s"><testcase classname="tests.unit.test_cart" name="test_totals"/></testsuite>');
      const { report } = await check({ cwd: repo, base: r.base, head: r.head, junit: join(repo, 'out [1]', '*.xml'), format: 'json', quiet: true });
      expect(report.findings.some((f) => f.ruleId === 'V005')).toBe(false);
      expect(readFileSync(join(repo, 'out [1]', 'junit.xml'), 'utf8')).toContain('test_totals');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
