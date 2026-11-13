import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pythonFrontEnd } from '../../lang-python/src/index.js';
import { javaFrontEnd } from '../../lang-java/src/index.js';
import { tsFrontEnd } from '../../lang-ts/src/index.js';
import { HelperIndex, isSupportPath, namesToIndex, resolveHelperCalls, scanSupportFiles, secondLevelNames, unresolvedCalls } from './helper-index.js';
import type { HelperIndexOptions } from './helper-index.js';
import { runEngine } from './engine.js';
import { defaultConfig } from './config.js';
import type { FrameworkProfile, LanguageFrontEnd, TestInventory } from './types.js';

const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };
const FRONT_ENDS: LanguageFrontEnd[] = [pythonFrontEnd, javaFrontEnd, tsFrontEnd];

let dir: string;
let cache: string;

function put(path: string, content: string): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function frontEndFor(path: string): LanguageFrontEnd | undefined {
  return FRONT_ENDS.find((fe) => fe.extensions.some((e) => path.endsWith(e)));
}

function makeIndex(extra: Partial<HelperIndexOptions> = {}): HelperIndex {
  return new HelperIndex({ cwd: dir, frontEndFor, extensions: FRONT_ENDS.flatMap((f) => f.extensions), ignore: [], profile, version: 'test', cacheDir: cache, cacheMinParseMs: 0, ...extra });
}

/** Inventory a test file in memory and resolve its calls against the index of `dir`. */
async function resolveIn(path: string, source: string, index = makeIndex()): Promise<{ inv: TestInventory; index: HelperIndex; resolved: ReturnType<typeof resolveHelperCalls> }> {
  const inv = await frontEndFor(path)!.inventory(path, source, profile);
  const tests = inv.tests.map((test) => ({ test, inv }));
  const names = namesToIndex(tests);
  await index.ensure(names);
  await index.ensure(secondLevelNames(index, names));
  const resolved = resolveHelperCalls(tests, index);
  return { inv, index, resolved };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-helper-index-'));
  cache = mkdtempSync(join(tmpdir(), 'tw-helper-cache-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

describe('isSupportPath', () => {
  it('accepts files under support directories and conftest.py anywhere', () => {
    for (const p of ['tests/lib/__init__.py', 'src/test/java/com/x/Base.java', 'packages/a/__tests__/util.ts', 'spec/support/matchers.js', 'src/testing/result.ts', 'src/test-utils/render.tsx', 'pkg/testutils/x.py', 'fixtures/a.py', 'pkg/conftest.py']) {
      expect(isSupportPath(p), p).toBe(true);
    }
  });
  it('rejects production paths and a support name that is the file itself', () => {
    for (const p of ['src/app.ts', 'lib/helpers.py', 'src/main/java/com/x/Util.java', 'tests', 'src/latest/x.py']) {
      expect(isSupportPath(p), p).toBe(false);
    }
  });
});

describe('scanSupportFiles', () => {
  it('skips symbolic links, node_modules, ignored paths and other extensions', () => {
    put('tests/helpers.py', 'def h():\n    assert True\n');
    put('tests/data.json', '{}');
    put('node_modules/x/tests/a.py', 'def h():\n    assert True\n');
    put('build/tests/b.py', 'def h():\n    assert True\n');
    put('outside/real.py', 'def h():\n    assert True\n');
    symlinkSync(join(dir, 'outside'), join(dir, 'tests', 'linked'));
    symlinkSync(join(dir, 'outside', 'real.py'), join(dir, 'tests', 'link.py'));
    const scan = scanSupportFiles(dir, ['.py'], ['**/build/**']);
    expect(scan.files.map((f) => f.path)).toEqual(['tests/helpers.py']);
    expect(scan.capped).toBe(false);
    expect(scan.warnings).toEqual([]);
  });

  it('names files with forward slashes and filters nested locations the same way on every platform', () => {
    put('pkg/a/tests/lib/helpers.py', 'def h():\n    assert True\n');
    put('pkg/a/generated/tests/gen.py', 'def h():\n    assert True\n');
    put('pkg/b/src/test/java/com/x/BaseTest.java', 'class BaseTest {}\n');
    const scan = scanSupportFiles(dir, ['.py', '.java'], ['pkg/*/generated/**']);
    expect(scan.files.map((f) => f.path).sort()).toEqual(['pkg/a/tests/lib/helpers.py', 'pkg/b/src/test/java/com/x/BaseTest.java']);
    expect(scan.files.every((f) => !f.path.includes('\\'))).toBe(true);
    // The location filter takes repository paths, never native ones: a backslash path is not a support location.
    expect(isSupportPath('pkg/a/tests/lib/helpers.py')).toBe(true);
    expect(isSupportPath('pkg\\a\\tests\\lib\\helpers.py')).toBe(false);
  });

  it('stops at the file cap with a warning and takes helper named files first', () => {
    for (let i = 0; i < 5; i++) put(`tests/test_${i}.py`, 'x = 1\n');
    put('tests/zz_helpers.py', 'x = 1\n');
    const scan = scanSupportFiles(dir, ['.py'], [], { maxFiles: 3, maxBytes: 1e9, maxFileBytes: 1e6, maxEntries: 1e6 });
    expect(scan.files.map((f) => f.path)).toEqual(['tests/zz_helpers.py', 'tests/test_0.py', 'tests/test_1.py']);
    expect(scan.capped).toBe(true);
    expect(scan.warnings[0]).toMatch(/stopped at 3 support files .* of 6/);
  });

  it('stops at the byte cap and skips oversized files', () => {
    put('tests/a.py', 'x' + ' '.repeat(99));
    put('tests/b.py', 'x' + ' '.repeat(99));
    put('tests/big.py', 'x' + ' '.repeat(5000));
    const scan = scanSupportFiles(dir, ['.py'], [], { maxFiles: 100, maxBytes: 150, maxFileBytes: 1000, maxEntries: 1e6 });
    expect(scan.files.map((f) => f.path)).toEqual(['tests/a.py']);
    expect(scan.capped).toBe(true);
    expect(scan.warnings.join('\n')).toMatch(/larger than 1 KB/);
  });
});

describe('resolution', () => {
  it('counts a method on a receiver defined in tests/lib (the pip shape)', async () => {
    put('tests/lib/__init__.py', 'class TestResult:\n    def did_create(self, path):\n        assert path in self.files_created\n\n    def files(self):\n        return self.files_created\n');
    const { inv, resolved } = await resolveIn('tests/test_install.py', 'def test_install(script):\n    result = script.pip("install", "x")\n    result.did_create("x")\n');
    const t = inv.tests[0]!;
    expect(t.assertions).toHaveLength(1);
    expect(t.assertions[0]).toMatchObject({ kind: 'custom', family: 'helper', resolvedVia: 'helper-index', text: 'result.did_create("x")', helper: { name: 'did_create', path: 'tests/lib/__init__.py', line: 2, className: 'TestResult' } });
    expect(resolved).toEqual([{ path: 'tests/test_install.py', test: 'test_install', line: 3, helper: 'TestResult.did_create', definedIn: 'tests/lib/__init__.py', definedLine: 2 }]);
  });

  it('does not count a helper without an assertion, and follows a second level', async () => {
    put('tests/support.py', 'def show(x):\n    print(x)\n\ndef check_inner(x):\n    assert x == 1\n\ndef outer(x):\n    check_inner(x)\n\ndef three(x):\n    outer(x)\n');
    const { inv } = await resolveIn('tests/test_a.py', 'def test_show():\n    show(1)\n\ndef test_outer():\n    outer(1)\n\ndef test_three():\n    three(1)\n');
    const by = Object.fromEntries(inv.tests.map((t) => [t.name, t.assertions.length]));
    // Depth 2 only: three -> outer -> check_inner is one level too deep.
    expect(by).toEqual({ test_show: 0, test_outer: 1, test_three: 0 });
  });

  it('prefers the definition on the test class chain when the same name exists with and without assertions', async () => {
    put('src/test/java/com/x/AbstractQueryTest.java', 'package com.x;\nabstract class AbstractQueryTest {\n  protected void runs(String sql) {\n    org.junit.jupiter.api.Assertions.assertEquals(1, 1);\n  }\n}\n');
    put('src/test/java/com/x/Runner.java', 'package com.x;\nclass Runner {\n  void runs(String sql) {\n    System.out.println(sql);\n  }\n}\n');
    put('src/test/java/com/x/OtherBase.java', 'package com.x;\nabstract class OtherBase {\n  protected void runs(String sql) {\n    System.out.println(sql);\n  }\n}\n');
    const src = (base: string) => `package com.x;\nimport org.junit.jupiter.api.Test;\nclass QTest extends ${base} {\n  @Test\n  void selects() {\n    runs("select 1");\n  }\n}\n`;
    const onAsserting = await resolveIn('src/test/java/com/x/QTest.java', src('AbstractQueryTest'));
    expect(onAsserting.inv.tests[0]!.assertions).toHaveLength(1);
    expect(onAsserting.inv.tests[0]!.assertions[0]!.helper?.className).toBe('AbstractQueryTest');
    const onSilent = await resolveIn('src/test/java/com/x/QTest.java', src('OtherBase'));
    expect(onSilent.inv.tests[0]!.assertions).toHaveLength(0);
  });

  it('counts an ambiguous receiver call when one definition asserts', async () => {
    put('src/test/java/com/x/support/Result.java', 'package com.x.support;\npublic class Result {\n  public void created(String p) {\n    org.junit.jupiter.api.Assertions.assertTrue(p.isEmpty());\n  }\n}\n');
    put('src/test/java/com/x/support/Log.java', 'package com.x.support;\npublic class Log {\n  public void created(String p) {\n    System.out.println(p);\n  }\n}\n');
    const { inv } = await resolveIn('src/test/java/com/x/ITest.java', 'package com.x;\nimport org.junit.jupiter.api.Test;\nclass ITest {\n  @Test\n  void installs() {\n    Result r = new Result();\n    r.created("a");\n  }\n}\n');
    expect(inv.tests[0]!.assertions.map((a) => a.helper?.className)).toEqual(['Result']);
  });

  it('resolves exported TypeScript functions and class methods', async () => {
    put('src/test-utils/cart.ts', "export function totalIs(c: { total(): number }, n: number): void {\n  expect(c.total()).toBe(n);\n}\nexport class Res {\n  hasFile(p: string): void {\n    expect(this.files).toContain(p);\n  }\n}\n");
    const { inv } = await resolveIn('src/cart.test.ts', "describe('c', () => {\n  it('a', () => {\n    totalIs(cart, 1);\n  });\n  it('b', () => {\n    res.hasFile('x');\n  });\n});\n");
    expect(inv.tests.map((t) => t.assertions.map((a) => a.helper?.name))).toEqual([['totalIs'], ['hasFile']]);
  });

  it('leaves framework calls and in file helpers alone', async () => {
    const inv = await pythonFrontEnd.inventory('tests/test_x.py', 'def check_it(x):\n    assert x\n\ndef test_x(mocker):\n    mocker.patch("a.b")\n    check_it(1)\n    print(1)\n    run()\n', profile);
    expect(unresolvedCalls(inv.tests[0]!, inv).map((c) => c.name)).toEqual([]);
  });
});

describe('cache', () => {
  it('serves unchanged files from the cache and reparses a touched one', async () => {
    put('tests/lib.py', 'def did_create(p):\n    assert p\n');
    const first = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    first.index.save();
    expect(first.index.parsedCount).toBe(1);
    const second = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    expect(second.index.parsedCount).toBe(0);
    expect(second.index.cachedCount).toBe(1);
    expect(second.inv.tests[0]!.assertions).toHaveLength(1);
    const later = new Date(Date.now() + 5000);
    put('tests/lib.py', 'def did_create(p):\n    print(p)\n');
    utimesSync(join(dir, 'tests/lib.py'), later, later);
    const third = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    expect(third.index.parsedCount).toBe(1);
    expect(third.inv.tests[0]!.assertions).toHaveLength(0);
  });

  it('never serves a stale entry when a file changes but keeps its size and mtime', async () => {
    // A copy that keeps mtimes (cpSync on Windows, an unzip, a restored cache) can swap content of the same length.
    const when = new Date('2026-01-02T03:04:05Z');
    put('tests/lib.py', 'def did_create(p):\n    assert p\n');
    utimesSync(join(dir, 'tests/lib.py'), when, when);
    const first = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    first.index.save();
    expect(first.inv.tests[0]!.assertions).toHaveLength(1);
    put('tests/lib.py', 'def did_create(p):\n    print(p)\n'.padEnd('def did_create(p):\n    assert p\n'.length, ' '));
    utimesSync(join(dir, 'tests/lib.py'), when, when);
    const second = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    expect(second.index.cachedCount).toBe(0);
    expect(second.index.parsedCount).toBe(1);
    expect(second.inv.tests[0]!.assertions).toHaveLength(0);
  });

  it('serves a cached entry when only the mtime changed, and treats a CRLF checkout of the same file as the same content', async () => {
    put('tests/lib.py', 'def did_create(p):\n    assert p\n');
    const first = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    first.index.save();
    const later = new Date(Date.now() + 5000);
    put('tests/lib.py', 'def did_create(p):\r\n    assert p\r\n');
    utimesSync(join(dir, 'tests/lib.py'), later, later);
    const second = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n');
    expect(second.index.parsedCount).toBe(0);
    expect(second.index.cachedCount).toBe(1);
    expect(second.inv.tests[0]!.assertions).toHaveLength(1);
  });

  it('parses only files that mention a called name', async () => {
    put('tests/lib.py', 'def did_create(p):\n    assert p\n');
    put('tests/other.py', 'def unrelated():\n    assert True\n');
    const { index } = await resolveIn('tests/test_a.py', 'def test_a():\n    did_create(1)\n', makeIndex({ cacheDir: false }));
    expect(index.parsedCount).toBe(1);
    expect(index.fileCount).toBe(2);
  });
});

describe('engine', () => {
  const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const sh = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });

  async function run(helperIndex?: false) {
    return runEngine({ cwd: dir, base: 'HEAD~1', head: 'HEAD', frontEnds: FRONT_ENDS, config: defaultConfig(), resolved: true, helperIndex: helperIndex === false ? false : { cacheDir: false } });
  }

  beforeEach(() => {
    sh('init', '-q', '-b', 'main');
    put('tests/lib/__init__.py', 'class Result:\n    def did_create(self, p):\n        assert p in self.files\n');
    put('tests/test_a.py', 'def test_one():\n    assert 1 == 1\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'base');
    put('tests/test_a.py', 'def test_one():\n    assert 1 == 1\n\ndef test_two(script):\n    result = script.run()\n    result.did_create("x")\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'head');
  });

  it('records resolved calls in the report and silences O001', async () => {
    const { report } = await run();
    expect(report.findings.filter((f) => f.ruleId === 'O001')).toEqual([]);
    expect(report.helperIndex).toMatchObject({ files: 2, helpers: 1, capped: false, warnings: [] });
    expect(report.helperIndex!.resolved).toEqual([{ path: 'tests/test_a.py', test: 'test_two', line: 6, helper: 'Result.did_create', definedIn: 'tests/lib/__init__.py', definedLine: 2 }]);
    expect(report.timing.helperIndexMs).toBeGreaterThanOrEqual(0);
  });

  it('can be turned off', async () => {
    const { report } = await run(false);
    expect(report.findings.filter((f) => f.ruleId === 'O001')).toHaveLength(1);
    expect(report.helperIndex).toBeUndefined();
  });
});
