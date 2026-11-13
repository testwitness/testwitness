import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GitError, commitMessages, git, listTree, mergeBase, numstat, rawDiff, revParse, showFile } from './git.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

let dir: string;
let first: string;
let second: string;
let side: string;

function sh(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });
}
function put(path: string, content: string | Buffer): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-git-'));
  sh('init', '-q', '-b', 'main');
  sh('config', 'commit.gpgsign', 'false');
  put('src/a.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  put('docs/old-name.md', 'line one\nline two\nline three\nline four\nline five\nline six\n');
  put('bin/blob.dat', Buffer.from([0, 1, 2, 3, 0, 255, 0, 7]));
  put('keep.txt', 'keep\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'first');
  first = sh('rev-parse', 'HEAD').trim();

  sh('checkout', '-q', '-b', 'side');
  put('side.txt', 'side\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'side work');
  side = sh('rev-parse', 'HEAD').trim();

  sh('checkout', '-q', 'main');
  put('src/a.ts', 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\n');
  sh('mv', 'docs/old-name.md', 'docs/new-name.md');
  put('bin/blob.dat', Buffer.from([0, 9, 9, 9, 0, 255, 0, 8, 1]));
  sh('add', '-A');
  sh('commit', '-q', '-m', 'second change\n\nSigned-off-by: Test <t@t>\nCo-Authored-By: Claude <noreply@anthropic.com>');
  second = sh('rev-parse', 'HEAD').trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('git', () => {
  it('returns stdout', async () => {
    expect((await git(['rev-parse', 'HEAD'], { cwd: dir })).trim()).toBe(second);
  });
  it('wraps failures in GitError with args and stderr', async () => {
    const err = await git(['rev-parse', '--verify', 'nope^{commit}'], { cwd: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    const ge = err as GitError;
    expect(ge.name).toBe('GitError');
    expect(ge.args).toEqual(['rev-parse', '--verify', 'nope^{commit}']);
    expect(ge.stderr.length).toBeGreaterThan(0);
    expect(ge.message).toContain('git rev-parse --verify nope^{commit} failed');
  });
});

describe('mergeBase', () => {
  it('finds the common ancestor of diverged branches', async () => {
    expect(await mergeBase('side', 'main', { cwd: dir })).toBe(first);
  });
  it('returns the base itself when it is an ancestor', async () => {
    expect(await mergeBase(first, second, { cwd: dir })).toBe(first);
  });
  it('throws when a ref is unknown', async () => {
    await expect(mergeBase('nope', 'main', { cwd: dir })).rejects.toBeInstanceOf(GitError);
  });
});

describe('revParse', () => {
  it('resolves names and short shas to the full commit sha', async () => {
    expect(await revParse('main', { cwd: dir })).toBe(second);
    expect(await revParse(second.slice(0, 8), { cwd: dir })).toBe(second);
    expect(await revParse('side', { cwd: dir })).toBe(side);
  });
  it('peels to a commit and trims the newline', async () => {
    const out = await revParse('HEAD', { cwd: dir });
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });
  it('throws for a missing ref', async () => {
    await expect(revParse('does-not-exist', { cwd: dir })).rejects.toBeInstanceOf(GitError);
  });
});

describe('rawDiff', () => {
  it('detects renames and uses zero context with a/ b/ prefixes', async () => {
    const out = await rawDiff(first, second, { cwd: dir });
    expect(out).toContain('rename from docs/old-name.md');
    expect(out).toContain('rename to docs/new-name.md');
    expect(out).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(out).toContain('@@ -2 +2 @@');
    expect(out).toContain('-export const b = 2;');
    expect(out).toContain('+export const b = 20;');
    expect(out).not.toContain('\u001b[');
    expect(out.split('\n')).not.toContain(' export const a = 1;');
  });
  it('is empty when nothing changed', async () => {
    expect(await rawDiff(second, second, { cwd: dir })).toBe('');
  });
});

describe('numstat', () => {
  it('counts lines for text files', async () => {
    const m = await numstat(first, second, { cwd: dir });
    expect(m.get('src/a.ts')).toEqual({ added: 2, deleted: 1 });
  });
  it('reports null counts for binary files', async () => {
    const m = await numstat(first, second, { cwd: dir });
    expect(m.get('bin/blob.dat')).toEqual({ added: null, deleted: null });
  });
  it('keys renames by the new path only', async () => {
    const m = await numstat(first, second, { cwd: dir });
    expect(m.get('docs/new-name.md')).toEqual({ added: 0, deleted: 0 });
    expect(m.has('docs/old-name.md')).toBe(false);
    expect(m.has('keep.txt')).toBe(false);
    expect(m.size).toBe(3);
  });
  it('is empty for identical refs', async () => {
    expect((await numstat(second, second, { cwd: dir })).size).toBe(0);
  });
});

describe('showFile', () => {
  it('reads a file at a ref', async () => {
    expect(await showFile(first, 'src/a.ts', { cwd: dir })).toBe('export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    expect(await showFile(second, 'src/a.ts', { cwd: dir })).toContain('export const d = 4;');
  });
  it('returns undefined when the path is absent at that ref', async () => {
    expect(await showFile(first, 'docs/new-name.md', { cwd: dir })).toBeUndefined();
    expect(await showFile(second, 'docs/old-name.md', { cwd: dir })).toBeUndefined();
    expect(await showFile(second, 'never/existed.ts', { cwd: dir })).toBeUndefined();
  });
  it('throws GitError for a bad ref', async () => {
    const err = await showFile('no-such-ref', 'src/a.ts', { cwd: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
  });
});

describe('listTree', () => {
  it('lists every file at a ref', async () => {
    expect((await listTree(first, { cwd: dir })).sort()).toEqual(['bin/blob.dat', 'docs/old-name.md', 'keep.txt', 'src/a.ts']);
    expect((await listTree(second, { cwd: dir })).sort()).toEqual(['bin/blob.dat', 'docs/new-name.md', 'keep.txt', 'src/a.ts']);
  });
  it('handles unusual file names without quoting', async () => {
    const e = await listTree('side', { cwd: dir });
    expect(e).toContain('side.txt');
    expect(e.every((p) => !p.startsWith('"'))).toBe(true);
  });
});

describe('commitMessages', () => {
  it('returns the messages in the range with trailers preserved', async () => {
    const msgs = await commitMessages(first, second, { cwd: dir });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('second change');
    expect(msgs[0]).toContain('Signed-off-by: Test <t@t>');
    expect(msgs[0]).toContain('Co-Authored-By: Claude <noreply@anthropic.com>');
    expect(msgs[0]!.endsWith('\n')).toBe(false);
  });
  it('is empty for an empty range', async () => {
    expect(await commitMessages(second, second, { cwd: dir })).toEqual([]);
  });
  it('returns each commit separately, newest first', async () => {
    sh('checkout', '-q', 'side');
    try {
      put('more.txt', 'm\n');
      sh('add', '-A');
      sh('commit', '-q', '-m', 'third on side');
      const msgs = await commitMessages(first, 'side', { cwd: dir });
      expect(msgs).toEqual(['third on side', 'side work']);
    } finally {
      sh('checkout', '-q', 'main');
    }
  });
});

describe('CRLF line endings', () => {
  let repo: string;
  let base: string;
  let head: string;
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: ENV });
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'tw-git-eol-'));
    run('init', '-q', '-b', 'main');
    run('config', 'commit.gpgsign', 'false');
    // Store the bytes as written, as a Windows repository that commits CRLF does.
    run('config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'only-eol.py'), 'def test_a():\n    assert 1\n');
    writeFileSync(join(repo, 'eol-and-edit.py'), 'def test_b():\n    assert 1 == 1\n    assert 2 == 2\n');
    run('add', '-A');
    run('commit', '-q', '-m', 'lf');
    base = run('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'only-eol.py'), 'def test_a():\r\n    assert 1\r\n');
    writeFileSync(join(repo, 'eol-and-edit.py'), 'def test_b():\r\n    assert 1 == 1\r\n    assert 2\r\n');
    run('add', '-A');
    run('commit', '-q', '-m', 'crlf');
    head = run('rev-parse', 'HEAD').trim();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('rawDiff leaves out a file whose only change is LF to CRLF, and shows only the real edit of one converted while edited', async () => {
    const out = await rawDiff(base, head, { cwd: repo });
    expect(out).not.toContain('only-eol.py');
    const hunkLines = out.split('\n').filter((l) => /^[-+](?![-+])/.test(l));
    expect(hunkLines.map((l) => l.replace(/\r$/, ''))).toEqual(['-    assert 2 == 2', '+    assert 2']);
  });

  it('numstat counts the same lines as the diff', async () => {
    const stats = await numstat(base, head, { cwd: repo });
    expect(stats.has('only-eol.py')).toBe(false);
    expect(stats.get('eol-and-edit.py')).toEqual({ added: 1, deleted: 1 });
  });

  it('showFile returns LF text for a file committed with CRLF', async () => {
    expect(await showFile(head, 'only-eol.py', { cwd: repo })).toBe('def test_a():\n    assert 1\n');
  });
});
