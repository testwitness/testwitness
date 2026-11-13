import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlobReader } from './git-batch.js';
import { showFile } from './git.js';

let repo = '';
let head = '';
const g = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'tw-batch-'));
  g(['init', '-q', '-b', 'main']);
  g(['config', 'core.autocrlf', 'false']);
  g(['config', 'commit.gpgsign', 'false']);
  g(['config', 'user.email', 't@example.invalid']);
  g(['config', 'user.name', 't']);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src', 'crlf.py'), 'def test_x():\r\n    assert 1 == 1\r\n');
  writeFileSync(join(repo, 'big.txt'), 'x'.repeat(3 * 1024 * 1024) + '\nend\n');
  writeFileSync(join(repo, 'empty.txt'), '');
  writeFileSync(join(repo, 'café.ts'), 'export const é = "ü";\n');
  for (let i = 0; i < 300; i++) writeFileSync(join(repo, 'src', `f${i}.ts`), `export const v${i} = ${i};\n`);
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'base']);
  head = g(['rev-parse', 'HEAD']);
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('BlobReader', () => {
  it('returns the same text as showFile for every kind of file', async () => {
    const r = new BlobReader({ cwd: repo });
    try {
      for (const p of ['src/a.ts', 'src/crlf.py', 'big.txt', 'empty.txt', 'café.ts']) {
        expect(await r.read(head, p)).toBe(await showFile(head, p, { cwd: repo }));
      }
    } finally {
      r.close();
    }
  });

  it('reads CRLF files as LF', async () => {
    const r = new BlobReader({ cwd: repo });
    try {
      expect(await r.read(head, 'src/crlf.py')).toBe('def test_x():\n    assert 1 == 1\n');
    } finally {
      r.close();
    }
  });

  it('answers undefined for a missing path, a directory and an unknown ref, and keeps going', async () => {
    const r = new BlobReader({ cwd: repo });
    try {
      expect(await r.read(head, 'nope.ts')).toBeUndefined();
      expect(await r.read(head, 'src')).toBeUndefined();
      expect(await r.read('0000000000000000000000000000000000000000', 'src/a.ts')).toBeUndefined();
      expect(await r.read(head, 'src/a.ts')).toBe('export const a = 1;\n');
    } finally {
      r.close();
    }
  });

  it('matches answers to requests when hundreds are in flight at once', async () => {
    const r = new BlobReader({ cwd: repo });
    try {
      const paths = Array.from({ length: 300 }, (_, i) => `src/f${i}.ts`);
      paths.splice(150, 0, 'missing.ts', 'big.txt');
      const out = await Promise.all(paths.map((p) => r.read(head, p)));
      out.forEach((text, i) => {
        const p = paths[i]!;
        if (p === 'missing.ts') expect(text).toBeUndefined();
        else if (p === 'big.txt') expect(text?.length).toBe(3 * 1024 * 1024 + 5);
        else expect(text).toBe(`export const v${p.slice(5, -3)} = ${p.slice(5, -3)};\n`);
      });
    } finally {
      r.close();
    }
  });

  it('falls back to showFile for a path the batch protocol cannot carry', async () => {
    const r = new BlobReader({ cwd: repo });
    try {
      expect(await r.read(head, 'line\nbreak.ts')).toBeUndefined();
    } finally {
      r.close();
    }
  });

  it('falls back to showFile when git cannot start in the directory', async () => {
    const r = new BlobReader({ cwd: join(repo, 'does-not-exist') });
    await expect(r.read(head, 'src/a.ts')).rejects.toThrow();
    r.close();
  });
});
