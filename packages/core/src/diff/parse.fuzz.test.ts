// Fuzz: the unified diff parser and git's quoted paths (docs/threat-model.md, "Fuzzing"). The diff text comes from
// `git diff`, but every path, header and line in it is chosen by the pull request.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fuzz, hostileText, mutated, TARGET_TIMEOUT_MS } from '../../../../fuzz/kit.js';
import { parseUnifiedDiff, unquote } from './parse.js';

const SEEDS = [
  ['diff --git a/src/a.test.ts b/src/a.test.ts', 'index 1111111..2222222 100644', '--- a/src/a.test.ts', '+++ b/src/a.test.ts', '@@ -3 +3 @@', "-  expect(add(1, 2)).toBe(3);", "+  expect(add(1, 2)).toBeDefined();", '@@ -9,2 +9,0 @@', '-  it("x", () => {});', '-', ''].join('\n'),
  ['diff --git a/old name.py b/new name.py', 'similarity index 91%', 'rename from old name.py', 'rename to new name.py', 'index 1111111..2222222 100644', '--- a/old name.py', '+++ b/new name.py', '@@ -1,0 +2 @@', '+import pytest', ''].join('\n'),
  ['diff --git "a/t\\303\\251st \\"q\\".js" "b/t\\303\\251st \\"q\\".js"', 'new file mode 100644', '--- /dev/null', '+++ "b/t\\303\\251st \\"q\\".js"', '@@ -0,0 +1 @@', '+x', '\\ No newline at end of file', ''].join('\n'),
  ['diff --git a/img.png b/img.png', 'deleted file mode 100644', 'index 1111111..0000000', 'Binary files a/img.png and /dev/null differ', ''].join('\n'),
  ['diff --git a/a b/b b/a b/b', 'rename from a b/b', 'rename to a b/b', ''].join('\n'),
];

/** A path as git writes it into a diff header with core.quotePath on: C style escapes inside double quotes when needed. */
function gitQuote(path: string): string {
  const bytes = Buffer.from(path, 'utf8');
  let out = '';
  let quoted = false;
  const add = (text: string): void => {
    out += text;
    quoted = true;
  };
  for (const b of bytes) {
    if (b === 0x22 || b === 0x5c) add(`\\${String.fromCharCode(b)}`);
    else if (b === 0x0a) add('\\n');
    else if (b === 0x09) add('\\t');
    else if (b === 0x0d) add('\\r');
    else if (b < 0x20 || b >= 0x7f) add(`\\${b.toString(8).padStart(3, '0')}`);
    else out += String.fromCharCode(b);
  }
  return quoted ? `"${out}"` : path;
}

/** Any path git can store: no NUL, valid UTF-8, not empty, no leading quote that git would not have written itself. */
const path = hostileText(4)
  .map((s) => Buffer.from(s.replace(/\0/g, ''), 'utf8').toString('utf8'))
  .filter((s) => s.length > 0 && s.length < 2000);

describe('fuzz: unified diff parser', () => {
  it('never throws, and every file it returns is well formed', async () => {
    await fuzz('unified diff parser', fc.oneof(mutated(SEEDS), fc.array(fc.oneof(fc.constantFrom('diff --git a/x b/x', 'diff --git ', '--- a/x', '+++ b/x', '--- ', '+++ ', '@@ -1 +1 @@', '@@ -1,2 +3,4 @@ ctx', '@@', '@@ -99999999999999999999,1 +1 @@', 'rename from ', 'rename to ', 'new file mode 100644', 'deleted file mode 100644', 'Binary files a/x and b/x differ', '\\ No newline at end of file', '+', '-', ' '), hostileText(3)), { maxLength: 30 }).map((l) => l.join('\n'))), (text) => {
      const files = parseUnifiedDiff(text);
      for (const f of files) {
        expect(typeof f.path).toBe('string');
        expect(['added', 'modified', 'deleted', 'renamed']).toContain(f.status);
        for (const h of f.hunks) {
          for (const n of [h.baseStart, h.baseCount, h.headStart, h.headCount]) expect(Number.isFinite(n) && n >= 0).toBe(true);
          expect(h.added.every((l) => typeof l === 'string') && h.removed.every((l) => typeof l === 'string')).toBe(true);
        }
        expect(f.addedLines.size).toBeLessThanOrEqual(f.hunks.reduce((n, h) => n + h.added.length, 0));
        expect(f.removedLines.size).toBeLessThanOrEqual(f.hunks.reduce((n, h) => n + h.removed.length, 0));
      }
      expect(files.length).toBeLessThanOrEqual(text.split('\n').filter((l) => l.replace(/\r$/, '').startsWith('diff --git ')).length);
    });
  }, TARGET_TIMEOUT_MS);

  it('rename and quoted paths: any path survives git quoting, in the rename lines and in the ---/+++ lines', async () => {
    await fuzz('diff rename and quoted paths', fc.tuple(path, path), ([from, to]) => {
      expect(unquote(gitQuote(from))).toBe(from);
      const renamed = parseUnifiedDiff(['diff --git a/x b/y', 'similarity index 90%', `rename from ${gitQuote(from)}`, `rename to ${gitQuote(to)}`, '@@ -1 +1 @@', '-a', '+b', ''].join('\n'));
      expect(renamed).toHaveLength(1);
      expect(renamed[0]!.path).toBe(to);
      if (from !== to) expect(renamed[0]!.oldPath).toBe(from);
      expect(renamed[0]!.status).toBe('renamed');
      const q = (prefix: string, p: string): string => (gitQuote(p).startsWith('"') ? `"${prefix}${gitQuote(p).slice(1)}` : `${prefix}${p}`);
      const modified = parseUnifiedDiff([`diff --git ${q('a/', to)} ${q('b/', to)}`, `--- ${q('a/', to)}`, `+++ ${q('b/', to)}`, '@@ -1 +1 @@', '-a', '+b', ''].join('\n'));
      expect(modified).toHaveLength(1);
      // An unquoted path that itself contains a tab is cut at the tab, as git marks trailing metadata with one; git quotes such paths.
      expect(modified[0]!.path).toBe(to);
    });
  }, TARGET_TIMEOUT_MS);

  it('unquote never throws on arbitrary text', async () => {
    await fuzz('diff unquote', hostileText(), (s) => {
      expect(typeof unquote(s)).toBe('string');
      expect(typeof unquote(`"${s}"`)).toBe('string');
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: found by the fuzzers and the ReDoS scan', () => {
  it('unquote keeps a lone trailing backslash instead of throwing', () => {
    // Found by the fuzzer: `"\\"` read past the end and threw a TypeError.
    expect(unquote('"\\"')).toBe('\\');
    expect(unquote('"a\\"')).toBe('a\\');
  });

  it('reads a header of 100 kB in linear time', () => {
    const header = `diff --git a/${' b/'.repeat(33_000)}\u2028x`;
    const t0 = performance.now();
    const files = parseUnifiedDiff(`${header}\nBinary files differ\n`);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(files).toHaveLength(1);
  });
});
