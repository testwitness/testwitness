import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnifiedDiff, unquote } from './parse.js';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3 +3 @@ export function f() {
-  return 1;
+  return 2;
@@ -10,0 +11,2 @@ const x = 1;
+const y = 2;
+const z = 3;
diff --git a/old.py b/new.py
similarity index 90%
rename from old.py
rename to new.py
index 3333333..4444444 100644
--- a/old.py
+++ b/new.py
@@ -1,2 +1 @@
-import os
-import sys
+import os, sys
diff --git a/gone.java b/gone.java
deleted file mode 100644
index 5555555..0000000
--- a/gone.java
+++ /dev/null
@@ -1,2 +0,0 @@
-class Gone {
-}
diff --git a/fresh.md b/fresh.md
new file mode 100644
index 0000000..6666666
--- /dev/null
+++ b/fresh.md
@@ -0,0 +1 @@
+hello
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/img.png differ
`;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(SAMPLE);

  it('finds every file with the right status', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['new.py', 'renamed'],
      ['gone.java', 'deleted'],
      ['fresh.md', 'added'],
      ['img.png', 'added'],
    ]);
  });

  it('records the old path of a rename', () => {
    expect(files[1]!.oldPath).toBe('old.py');
  });

  it('parses hunks with and without counts', () => {
    const a = files[0]!;
    expect(a.hunks).toHaveLength(2);
    expect(a.hunks[0]).toMatchObject({ baseStart: 3, baseCount: 1, headStart: 3, headCount: 1, removed: ['  return 1;'], added: ['  return 2;'] });
    expect(a.hunks[1]).toMatchObject({ baseStart: 10, baseCount: 0, headStart: 11, headCount: 2 });
    expect([...a.addedLines]).toEqual([3, 11, 12]);
    expect([...a.removedLines]).toEqual([3]);
  });

  it('marks binary files', () => {
    expect(files[4]!.binary).toBe(true);
    expect(files[4]!.hunks).toHaveLength(0);
  });

  it('returns no files for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('unquote', () => {
  it('leaves plain paths alone', () => {
    expect(unquote('a/b c.ts')).toBe('a/b c.ts');
  });
  it('decodes C style escapes and octal utf8', () => {
    expect(unquote('"caf\\303\\251.ts"')).toBe('café.ts');
    expect(unquote('"tab\\there"')).toBe('tab\there');
    expect(unquote('"q\\"uote"')).toBe('q"uote');
  });
});

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}

describe('parseUnifiedDiff against real git output (property)', () => {
  it('added and removed line numbers point at the right content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-diff-'));
    try {
      const lineArb = fc.stringMatching(/^[a-z0-9 ]{0,12}$/);
      const fileArb = fc.array(lineArb, { minLength: 1, maxLength: 20 });
      fc.assert(
        fc.property(fileArb, fileArb, (before, after) => {
          const a = join(dir, 'before.txt');
          const b = join(dir, 'after.txt');
          writeFileSync(a, before.join('\n') + '\n');
          writeFileSync(b, after.join('\n') + '\n');
          let out: string;
          try {
            out = sh(dir, ['diff', '--no-index', '--unified=0', '--no-color', a, b]);
          } catch (e) {
            out = (e as { stdout: string }).stdout; // git diff exits 1 when files differ
          }
          const files = parseUnifiedDiff(out);
          if (before.join('\n') === after.join('\n')) {
            expect(files).toHaveLength(0);
            return;
          }
          expect(files).toHaveLength(1);
          const f = files[0]!;
          for (const h of f.hunks) {
            h.added.forEach((text, k) => expect(after[h.headStart - 1 + k]).toBe(text));
            h.removed.forEach((text, k) => expect(before[h.baseStart - 1 + k]).toBe(text));
          }
          expect(f.addedLines.size).toBe(f.hunks.reduce((n, h) => n + h.added.length, 0));
        }),
        { numRuns: 100 },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
