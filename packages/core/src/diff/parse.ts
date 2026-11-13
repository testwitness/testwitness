import type { ChangedFile, FileStatus, Hunk } from '../types.js';
import { toLf } from '../eol.js';

/**
 * Parse the output of `git diff --find-renames --unified=0`.
 * Returns files without classification (kind = 'other'); classify.ts fills that in.
 */
export function parseUnifiedDiff(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  // Lines of a CRLF file arrive with their CR; drop it so a hunk line is the same text on Windows and Linux. git
  // quotes a path that ends in CR, so no header loses a character.
  const lines = toLf(text).split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith('diff --git ')) {
      i++;
      continue;
    }
    // Header
    const header = line;
    let status: FileStatus = 'modified';
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let binary = false;
    i++;
    // Extended headers until '---' or next 'diff --git' or 'Binary files'
    while (i < lines.length && !lines[i]!.startsWith('diff --git ') && !lines[i]!.startsWith('--- ') && !lines[i]!.startsWith('@@')) {
      const h = lines[i]!;
      if (h.startsWith('new file mode')) status = 'added';
      else if (h.startsWith('deleted file mode')) status = 'deleted';
      else if (h.startsWith('rename from ')) {
        status = 'renamed';
        oldPath = unquote(h.slice('rename from '.length));
      } else if (h.startsWith('rename to ')) {
        newPath = unquote(h.slice('rename to '.length));
      } else if (h.startsWith('Binary files ')) {
        binary = true;
      }
      i++;
    }
    // --- a/x and +++ b/y
    while (i < lines.length && (lines[i]!.startsWith('--- ') || lines[i]!.startsWith('+++ '))) {
      const h = lines[i]!;
      if (h.startsWith('--- ')) {
        const p = h.slice(4).split('\t')[0]!;
        if (p !== '/dev/null') oldPath ??= stripPrefix(unquote(p), 'a/');
      } else {
        const p = h.slice(4).split('\t')[0]!;
        if (p !== '/dev/null') newPath ??= stripPrefix(unquote(p), 'b/');
      }
      i++;
    }
    if (!oldPath && !newPath) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
      if (m) {
        oldPath = m[1];
        newPath = m[2];
      }
    }
    const path = (status === 'deleted' ? oldPath : newPath) ?? newPath ?? oldPath ?? '';

    const hunks: Hunk[] = [];
    while (i < lines.length && lines[i]!.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]!);
      if (!m) break;
      const hunk: Hunk = {
        baseStart: Number(m[1]),
        baseCount: m[2] === undefined ? 1 : Number(m[2]),
        headStart: Number(m[3]),
        headCount: m[4] === undefined ? 1 : Number(m[4]),
        removed: [],
        added: [],
      };
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.startsWith('-')) hunk.removed.push(l.slice(1));
        else if (l.startsWith('+')) hunk.added.push(l.slice(1));
        else if (l.startsWith('\\')) {
          /* no newline marker */
        } else if (l.startsWith(' ')) {
          // context line (should not appear with unified=0 but be tolerant)
        } else break;
        i++;
      }
      hunks.push(hunk);
    }

    const addedLines = new Set<number>();
    const removedLines = new Set<number>();
    for (const h of hunks) {
      for (let k = 0; k < h.added.length; k++) addedLines.add(h.headStart + k);
      for (let k = 0; k < h.removed.length; k++) removedLines.add(h.baseStart + k);
    }

    const file: ChangedFile = {
      status,
      path,
      kind: 'other',
      hunks,
      binary,
      addedLines,
      removedLines,
    };
    if (status === 'renamed' && oldPath && oldPath !== path) file.oldPath = oldPath;
    files.push(file);
  }
  return files;
}

function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** git quotes paths with special characters using C style escapes. */
export function unquote(s: string): string {
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const inner = s.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = inner[i + 1]!;
    i++;
    switch (n) {
      case 'n': bytes.push(10); break;
      case 't': bytes.push(9); break;
      case 'r': bytes.push(13); break;
      case '"': bytes.push(34); break;
      case '\\': bytes.push(92); break;
      case 'a': bytes.push(7); break;
      case 'b': bytes.push(8); break;
      case 'f': bytes.push(12); break;
      case 'v': bytes.push(11); break;
      default: {
        const oct = inner.slice(i, i + 3);
        if (/^[0-7]{3}$/.test(oct)) {
          bytes.push(parseInt(oct, 8));
          i += 2;
        } else {
          bytes.push(...Buffer.from(n, 'utf8'));
        }
      }
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
