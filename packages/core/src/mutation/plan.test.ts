import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultConfig } from '../config.js';
import { javaClassName, planMutation, renderMutationPlanShell } from './plan.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
function write(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

function repo(): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tw-plan-'));
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'src/cart.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n');
  write(dir, 'src/old.ts', 'export const gone = 1;\nexport const kept = 2;\n');
  write(dir, 'src/main/java/com/acme/Cart.java', 'package com.acme;\n\npublic class Cart {\n  int total() { return 0; }\n}\n');
  write(dir, 'src/test/java/com/acme/CartTest.java', 'package com.acme;\n\nclass CartTest {}\n');
  write(dir, 'lib/billing.py', 'def total():\n    return 0\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'src/cart.ts', 'export const a = 1;\nexport const b = 20;\nexport const c = 30;\nexport const d = 4;\nexport const e = 50;\nexport const f = 6;\n');
  write(dir, 'src/old.ts', 'export const kept = 2;\n');
  write(dir, 'src/new.js', 'export const x = 1;\n');
  write(dir, 'src/cart.test.ts', "it('x', () => {});\n");
  write(dir, 'src/main/java/com/acme/Cart.java', 'package com.acme;\n\npublic class Cart {\n  int total() { return 1; }\n}\n');
  write(dir, 'src/main/java/com/acme/Refund.java', '/* package com.wrong; */\npackage com.acme;\n\npublic class Refund {}\n');
  write(dir, 'lib/billing.py', 'def total():\n    return 1\n');
  write(dir, "src/we ird$(touch pwned).ts", 'export const y = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
}

describe('mutate plan', () => {
  it('plans Stryker line ranges and PIT classes and tests for the changed production files only', async () => {
    const r = repo();
    try {
      const plan = await planMutation({ cwd: r.dir, base: r.base, head: r.head, config: defaultConfig() });
      expect(plan.base).toBe(r.base);
      expect(plan.head).toBe(r.head);
      expect(plan.files.map((f) => [f.path, f.tool])).toEqual([
        ['lib/billing.py', 'none'],
        ['src/cart.ts', 'stryker'],
        ['src/main/java/com/acme/Cart.java', 'pit'],
        ['src/main/java/com/acme/Refund.java', 'pit'],
        ['src/new.js', 'stryker'],
      ]);
      expect(plan.files.find((f) => f.path === 'src/cart.ts')!.ranges).toEqual([
        [2, 3],
        [5, 6],
      ]);
      expect(plan.stryker.mutate).toEqual(['src/cart.ts:2-3', 'src/cart.ts:5-6', 'src/new.js:1-1']);
      expect(plan.stryker.args).toEqual(['stryker', 'run', '--mutate', 'src/cart.ts:2-3,src/cart.ts:5-6,src/new.js:1-1', '--incremental', '--coverageAnalysis', 'perTest', '--reporters', 'json,clear-text']);
      expect(plan.pit.targetClasses).toEqual(['com.acme.Cart', 'com.acme.Cart$*', 'com.acme.Refund', 'com.acme.Refund$*']);
      expect(plan.pit.targetTests).toEqual(['com.acme.*', 'com.acme.CartTest']);
      expect(plan.pit.args).toContain('-DtargetClasses=com.acme.Cart,com.acme.Cart$*,com.acme.Refund,com.acme.Refund$*');
      expect(plan.pit.args).toContain('-DfullMutationMatrix=true');
      expect(plan.notes.join('\n')).toMatch(/Left out "src\/we ird\$\(touch pwned\)\.ts"/);
      expect(plan.notes.join('\n')).toMatch(/No test class named after com.acme.Refund/);
      expect(plan.notes.join('\n')).toMatch(/Python files are listed but not planned/);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('renders single quoted shell assignments that a shell can source without running anything', async () => {
    const r = repo();
    try {
      const plan = await planMutation({ cwd: r.dir, base: r.base, head: r.head, config: defaultConfig() });
      const sh = renderMutationPlanShell(plan);
      expect(sh).toContain("STRYKER_MUTATE='src/cart.ts:2-3,src/cart.ts:5-6,src/new.js:1-1'");
      expect(sh).toContain("PIT_TARGET_TESTS='com.acme.*,com.acme.CartTest'");
      const file = join(r.dir, 'plan.env');
      writeFileSync(file, sh);
      const out = execFileSync('sh', ['-c', `. "$1" && printf '%s|%s|%s' "$STRYKER_MUTATE" "$PIT_TARGET_CLASSES" "$TESTWITNESS_HEAD"`, 'sh', file], { cwd: r.dir, encoding: 'utf8' });
      expect(out).toBe(`src/cart.ts:2-3,src/cart.ts:5-6,src/new.js:1-1|com.acme.Cart,com.acme.Cart$*,com.acme.Refund,com.acme.Refund$*|${r.head}`);
      expect(() => execFileSync('test', ['-e', join(r.dir, 'pwned')])).toThrow();
      expect(renderMutationPlanShell({ ...plan, notes: ["it's\n$(touch pwned)"] }).split('\n').filter((l) => l.includes('pwned'))).toEqual(["# it's $(touch pwned)"]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it('plans nothing for a PR without production changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-plan-empty-'));
    try {
      git(dir, 'init', '-q', '-b', 'main');
      write(dir, 'src/a.test.ts', "it('a', () => {});\n");
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'base');
      write(dir, 'src/a.test.ts', "it('b', () => {});\n");
      git(dir, 'commit', '-q', '-am', 'head');
      const plan = await planMutation({ cwd: dir, base: 'HEAD~1', head: 'HEAD', config: defaultConfig() });
      expect(plan.files).toEqual([]);
      expect(plan.stryker.args).toEqual([]);
      expect(plan.pit.args).toEqual([]);
      expect(renderMutationPlanShell(plan)).toContain("STRYKER_MUTATE=''");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('java class names', () => {
  it('reads the package declaration, then the source root, then the bare name', () => {
    expect(javaClassName('x/Cart.java', 'package com.acme;\nclass Cart {}')).toBe('com.acme.Cart');
    expect(javaClassName('x/Cart.java', '/* package com.wrong; */\npackage com.acme;')).toBe('com.acme.Cart');
    expect(javaClassName('mod/src/main/java/com/acme/Cart.java', 'class Cart {}')).toBe('com.acme.Cart');
    expect(javaClassName('Cart.java', undefined)).toBe('Cart');
  });
});
