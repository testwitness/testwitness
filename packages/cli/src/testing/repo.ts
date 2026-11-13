// Test helper: a small git repository in a temp dir, with a test file an agent can weaken.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@testwitness.local', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@testwitness.local' };

export const MATH_TEST = [
  "import { describe, expect, it } from 'vitest';",
  "import { add } from './math';",
  '',
  "describe('add', () => {",
  "  it('adds two numbers', () => {",
  '    expect(add(1, 2)).toBe(3);',
  '  });',
  '',
  "  it('handles negatives', () => {",
  '    expect(add(-1, -2)).toBe(-3);',
  '  });',
  '});',
  '',
].join('\n');

/** The same file with the second test skipped and the first assertion loosened. */
export const MATH_TEST_WEAKENED = MATH_TEST.replace('expect(add(1, 2)).toBe(3);', 'expect(add(1, 2)).toBeDefined();').replace("it('handles negatives'", "it.skip('handles negatives'");

export interface TestRepo {
  dir: string;
  git(...args: string[]): string;
  write(rel: string, text: string): void;
  remove(rel: string): void;
  /** `git status`, refs, stashes and the object count: equal before and after means nothing was written. */
  state(): string;
  dispose(): void;
}

/** A repository on `main` with one commit: src/math.ts, src/math.test.ts (two tests), src/other.test.ts and .gitignore. */
export function makeRepo(files: Record<string, string> = {}): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'tw-repo-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: ENV });
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  git('init', '-q', '-b', 'main');
  write('src/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
  write('src/math.test.ts', MATH_TEST);
  write('src/other.test.ts', "import { expect, it } from 'vitest';\n\nit('is true', () => {\n  expect(1 + 1).toBe(2);\n});\n");
  write('.gitignore', 'ignored/\n');
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return {
    dir,
    git,
    write,
    remove: (rel) => rmSync(join(dir, rel), { force: true }),
    state: () => [git('status', '--porcelain=v1', '-uall'), git('count-objects', '-v'), git('for-each-ref'), git('stash', 'list'), git('ls-files', '--stage')].join('\n---\n'),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** src/other.test.ts with its only test focused: R005, high. */
export const OTHER_TEST_FOCUSED = "import { expect, it } from 'vitest';\n\nit.only('is true', () => {\n  expect(1 + 1).toBe(2);\n});\n";
