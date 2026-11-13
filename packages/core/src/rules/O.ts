import picomatch from 'picomatch';
import type { Finding, Rule, RuleContext, TestCase } from '../types.js';
import { allChanges, isSkipped, isXfail } from '../inventory.js';
import { makeFinding } from './util.js';
import { mutationOracle } from './M.js';

const RULE_SINCE = '0.1.0';

const SMOKE_NAME = /contextloads|smoke|doesnotthrow|does_not_throw|does_not_raise|noexception|sanity/i;

/** O001 New test without an assertion. */
export const O001: Rule = {
  id: 'O001',
  name: 'New test without an assertion',
  group: 'O',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A test added in this PR has no assertion: no framework assertion, no exception expectation, no snapshot, and no call to an assertion helper defined in the file, in a test support file of the checkout, or configured in assertions.extra.',
    falsePositives:
      'Smoke tests named contextLoads, smoke or DoesNotThrow are reported low with the label smoke. Helpers whose body contains an assertion are counted as assertions, whether they are defined in the test file or in a test support file of the checkout (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test), and a helper that calls another helper that asserts counts too. Only helpers outside those locations, or without an assertion the front end can read inside, need assertions.extra. Assertions inside nested scopes of the test body (callbacks, lambdas, anonymous and local classes, inner functions) are counted. The default is low (informational): on public PRs half of the new tests without an assertion were intentional smoke tests (race tests, verbose output tests, does not throw tests), so a static rule cannot carry medium or high here. Raise it per repository with rules: { O001: medium } in .testwitness.yml. With mutation reports from the opt in mutation job (docs/mutation-on-request.md) the oracle is measured instead of guessed: when the changed production lines the test exercises carry mutants and none of them was killed, the finding is medium with the label measured weak; when the test itself killed a mutant on those lines (it notices a wrong result, for example through an exception), the finding is dropped. Which production files a test exercises comes from the coverage the mutation report records, or from the name and imports of the test file when it records none.',
    example: '+  @Test\n+  void processesBatch() {\n+    service.process(batch);\n+  }',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (t.assertions.length > 0) continue;
      if (t.statementCount === 0) continue; // an empty new test is a todo, not an oracle problem; R010 covers marked ones
      if (t.overrideOnly) continue; // the inherited test carries the oracle
      if (isSkipped(t) || isXfail(t)) continue;
      const smoke = SMOKE_NAME.test(t.name);
      const measured = mutationOracle(ctx, pair, t);
      if (measured === 'strong') continue; // it killed a mutant on a changed line: the oracle is measured, not guessed
      const weak = measured === 'weak';
      const label = weak ? 'measured weak' : smoke ? 'smoke' : undefined;
      out.push(
        makeFinding(ctx, 'O001', weak ? 'medium' : 'low', pair.file, t.qualifiedName, `New test ${t.qualifiedName} has no assertion${weak ? ', and no mutant on the changed lines it exercises was killed' : ''}`, {
          line: t.startLine,
          endLine: t.endLine,
          ...(label ? { label } : {}),
          snippet: t.bodyHash,
        }),
      );
    }
    return out;
  },
};

function onlySmoke(t: TestCase): boolean {
  return t.assertions.length > 0 && t.assertions.every((a) => a.kind === 'smoke' || a.kind === 'snapshot');
}

/** A no throw check: expect(fn).not.toThrow(), assert.doesNotThrow, assertDoesNotThrow, assertThatCode(...).doesNotThrowAnyException(). */
const NO_THROW = /(^|\.)(assertDoesNotThrow|doesNotThrowAnyException|doesNotThrow|doesNotReject)$|\.not\.(toThrow|toThrowError|throw|throws)$/;

function onlyNoThrow(t: TestCase): boolean {
  return t.assertions.length > 0 && t.assertions.every((a) => NO_THROW.test(a.callee) || (a.family === 'exception' && a.kind === 'smoke'));
}

/** O002 New test with a smoke oracle only. */
export const O002: Rule = {
  id: 'O002',
  name: 'New test with a smoke oracle only',
  group: 'O',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A new test whose only assertions are existence or type checks (toBeDefined, assertNotNull, isNotNone, not.toThrow, assertDoesNotThrow) or a bare snapshot. It proves the code ran, not what it did.',
    falsePositives:
      'A test that is meant as a smoke test. Reported low by default; medium when the PR text calls it a regression test, unless every assertion of the test is a does not throw check (not.toThrow, assertDoesNotThrow, doesNotThrowAnyException): a crash regression is pinned by not throwing, so the claim says nothing against such a test. With mutation reports (docs/mutation-on-request.md) it is measured: medium with the label measured weak when no mutant on the changed lines the test exercises was killed, and dropped when the test itself killed one of them, because then the existence check is measured strong enough for the change. Ships at low (informational) by default until its measured precision improves: when this default was set (13 November 2026), its precision on medium and high findings on the held out half of the corpus was 0.00, and neither of its 2 findings in the 300 PR real world trial was true. Raise it per repository with rules: { O002: medium } in .testwitness.yml.',
    example: "+  it('computes the discount', () => {\n+    expect(computeDiscount(cart)).toBeDefined();\n+  });",
  },
  run(ctx) {
    const out: Finding[] = [];
    const regression = ctx.prText ? /\bregression\b|\bfix(es|ed)?\b.*\btests?\b/i.test(`${ctx.prText.title}\n${ctx.prText.body}`) : false;
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (!onlySmoke(t)) continue;
      if (isSkipped(t) || isXfail(t)) continue;
      const kinds = [...new Set(t.assertions.map((a) => a.callee))].join(', ');
      const measured = mutationOracle(ctx, pair, t);
      if (measured === 'strong') continue; // it killed a mutant on a changed line: the oracle is measured, not guessed
      const weak = measured === 'weak';
      // A crash regression is pinned by "does not throw": for such a test the PR's regression claim is no evidence of
      // a weak oracle, because not throwing is the whole contract (a validator that accepts its input).
      const raised = regression && !onlyNoThrow(t);
      out.push(
        makeFinding(ctx, 'O002', raised || weak ? 'medium' : 'low', pair.file, t.qualifiedName, `New test ${t.qualifiedName} only checks existence or a snapshot (${kinds})${weak ? ', and no mutant on the changed lines it exercises was killed' : ''}`, {
          line: t.startLine,
          endLine: t.endLine,
          label: weak ? 'measured weak' : 'smoke',
          snippet: t.bodyHash,
        }),
      );
    }
    return out;
  },
};

/** Directories and names that hold test support code by convention, never test files a runner collects. */
const SUPPORT_DIR = /(^|\/)(__fixtures__|fixtures?|__mocks__|__snapshots__|samples?)\//;
const SUPPORT_NAME = /^_|\.fixtures?\.[^.]+$|^package-info\.java$/;
/** Names each runner collects by default: Surefire and Gradle (Test*, *Test, *Tests, *TestCase, *IT), pytest and unittest (test_*.py, *_test.py, tests.py), Jest, Vitest, Playwright and node:test (*.test.*, *.spec.*). */
const JAVA_COLLECTED = /^(Test\w*|\w*(Test|Tests|TestCase|IT))\.java$/;
const PY_COLLECTED = /^(test_\w*|\w+_test|tests?)\.py$/;
const JS_COLLECTED = /\.(test|spec)\.[cm]?[jt]sx?$/;
const JS_EXT = /\.[cm]?[jt]sx?$/;
/** Top level calls that declare suites or hooks, or load modules, rather than generate tests. */
const NOT_GENERATOR = new Set(['describe', 'context', 'suite', 'it', 'test', 'specify', 'before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'setup', 'teardown', 'suiteSetup', 'suiteTeardown', 'require', 'jest', 'vi', 'expect', 'console', 'process', 'Object', 'module', 'exports', 'import', 'QUnit', 'if', 'for', 'while', 'switch', 'with', 'return', 'function', 'async', 'void', 'typeof']);

async function usesMocha(ctx: RuleContext): Promise<boolean> {
  if (ctx.pairs.some((p) => p.head?.framework === 'mocha' || p.base?.framework === 'mocha')) return true;
  for (const f of ['.mocharc.yml', '.mocharc.yaml', '.mocharc.json', '.mocharc.jsonc', '.mocharc.js', '.mocharc.cjs']) if ((await ctx.readHead(f)) !== undefined) return true;
  if (/"mocha"\s*:/.test((await ctx.readHead('package.json')) ?? '')) return true;
  return false;
}

/** Mocha in the repository, or Mocha tests next to the file (the first few test files of its directory). */
async function mochaAt(ctx: RuleContext, dir: string, repoWide: () => Promise<boolean>): Promise<boolean> {
  if (await repoWide()) return true;
  const siblings = (await ctx.headTestFiles()).filter((f) => f.slice(0, f.lastIndexOf('/')) === dir && JS_COLLECTED.test(f)).slice(0, 3);
  for (const f of siblings) if ((await ctx.headInventoryFor(f))?.framework === 'mocha') return true;
  return false;
}

/**
 * Would a test runner collect this file at all? Only such files can "define no tests": a helper, listener, sample,
 * fixture or mock in a test directory is support code by design. Paths configured in paths.tests count as collected.
 */
async function collectedByRunner(ctx: RuleContext, path: string, language: string | undefined, mocha: () => Promise<boolean>): Promise<boolean> {
  const name = path.split('/').pop() ?? path;
  if (SUPPORT_DIR.test(path) || SUPPORT_NAME.test(name)) return false;
  if (ctx.config.paths.tests.length > 0 && picomatch(ctx.config.paths.tests, { dot: true })(path)) return true;
  if (language === 'java') return JAVA_COLLECTED.test(name);
  if (language === 'python') return PY_COLLECTED.test(name);
  if (language === 'typescript' || language === 'javascript') {
    if (JS_COLLECTED.test(name)) return true;
    const parent = path.split('/').slice(-2, -1)[0];
    // Jest collects every script directly inside __tests__; Mocha loads every script directly inside test/ by default.
    if (parent === '__tests__' && JS_EXT.test(name)) return true;
    if (parent === 'test' && /\.[cm]?js$/.test(name)) return mochaAt(ctx, path.slice(0, path.lastIndexOf('/')), mocha);
    return false;
  }
  return false;
}

/** The first top level call that is not a suite, hook or module load, such as `runFormatTest(import.meta, [...])`. */
function topLevelGenerator(src: string): string | undefined {
  for (const line of src.split(/\r?\n/)) {
    const m = /^(?:await\s+)?([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\s*\(/.exec(line);
    if (m && !NOT_GENERATOR.has(m[1]!)) return m[1];
  }
  return undefined;
}

/** O006 New test file with no tests collected. */
export const O006: Rule = {
  id: 'O006',
  name: 'New test file with no tests collected',
  group: 'O',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A new file that the test runner would collect (named the way the runner finds test files) defines no collectable test (wrong name prefix, missing @Test, describe without it). It reads as coverage and runs nothing.',
    falsePositives:
      'Only files a runner collects by name are checked: *Test, Test*, *Tests, *TestCase and *IT classes in Java; test_*.py, *_test.py and tests.py in Python; *.test.* and *.spec.* scripts, scripts directly inside __tests__, and with Mocha scripts directly inside test/ in JavaScript and TypeScript; plus anything matching paths.tests. Helpers, listeners, samples, stubs and harnesses with other names, package-info.java, names starting with an underscore, *.fixture.* files and anything under __fixtures__, fixtures, __mocks__, __snapshots__ or samples directories are support code and never reported. A collected script that declares no test but makes a top level call to a project function (such as runFormatTest(import.meta, [...])) generates its tests at run time and is reported low with the label generated.',
    example: '+// tests/helpers.test.ts\n+export function makeUser() { ... }',
  },
  async run(ctx) {
    const out: Finding[] = [];
    let mochaP: Promise<boolean> | undefined;
    const mocha = (): Promise<boolean> => (mochaP ??= usesMocha(ctx));
    for (const pair of ctx.pairs) {
      if (pair.file.status !== 'added' || !pair.head) continue;
      if (pair.head.tests.length > 0) continue;
      if (pair.head.parseErrors > 0) continue;
      if (!(await collectedByRunner(ctx, pair.file.path, pair.file.language, mocha))) continue;
      const src = (await ctx.readHead(pair.file.path)) ?? '';
      // A concrete subclass of an abstract test base inherits its tests; the per file inventory cannot see them.
      if (pair.file.language === 'java') {
        if (/\bclass\s+\w+\s+extends\s+\w+/.test(src) && !/\babstract\s+class\b/.test(src)) continue;
      }
      const generator = pair.file.language === 'typescript' || pair.file.language === 'javascript' ? topLevelGenerator(src) : undefined;
      if (generator) {
        out.push(
          makeFinding(ctx, 'O006', 'low', pair.file, pair.file.path, `New test file ${pair.file.path} declares no test itself; its top level call to ${generator} may generate tests at run time`, { snippet: 'no-tests', label: 'generated' }),
        );
        continue;
      }
      // Helper only files: exports with assertion helpers and nothing else are still "no tests"; report.
      out.push(
        makeFinding(ctx, 'O006', 'medium', pair.file, pair.file.path, `New test file ${pair.file.path} defines no tests the runner would collect`, { snippet: 'no-tests' }),
      );
    }
    return out;
  },
};

export function rulesO(): Rule[] {
  return [O001, O002, O006];
}
