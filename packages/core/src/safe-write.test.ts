import { describe, expect, it } from 'vitest';
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileNoFollow } from './safe-write.js';

describe('writeFileNoFollow', () => {
  it('writes a new file and replaces an existing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-write-'));
    try {
      const p = join(dir, 'out.json');
      await writeFileNoFollow(p, 'one');
      await writeFileNoFollow(p, '2');
      expect(readFileSync(p, 'utf8')).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('does not write through a symbolic link a pull request committed at the output path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-write-'));
    try {
      const victim = join(dir, 'victim.txt');
      writeFileSync(victim, 'untouched');
      const out = join(dir, 'testwitness.json');
      symlinkSync(victim, out);
      await writeFileNoFollow(out, '{"state":"pass"}');
      expect(readFileSync(victim, 'utf8')).toBe('untouched');
      expect(lstatSync(out).isSymbolicLink()).toBe(false);
      expect(readFileSync(out, 'utf8')).toBe('{"state":"pass"}');
      // A dangling link is replaced too.
      const out2 = join(dir, 'testwitness.md');
      symlinkSync(join(dir, 'does-not-exist'), out2);
      await writeFileNoFollow(out2, 'x');
      expect(lstatSync(out2).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(dir, 'does-not-exist'), { throwIfNoEntry: false })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
