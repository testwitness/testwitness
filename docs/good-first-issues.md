# Good first issues

Ten small, real gaps, each found by the precision corpus or the fixtures. Each one is a single
rule or front end change, one or two golden fixture cases and one line in the rule docs. The
maintainer reviews within two days and pairs on the first PR if you want.

How to start: read [conventions](conventions.md), run `pnpm install && pnpm check`, then look at an
existing case under `fixtures/<project>/cases/` with the same rule id. Every change needs a positive
case (the shape is reported) and a negative control (a similar shape that must stay quiet).

`scripts/open-good-first-issues.sh` opens these as GitHub issues (maintainer only).

## 1. W002: `continue-on-error` set from an expression

Today only a literal `continue-on-error: true` on a test step or job is reported. Real workflows use
`continue-on-error: ${{ matrix.experimental }}` or `${{ matrix.python == '3.14' }}` to let one leg of a
matrix fail. Report these at low with the label `conditional`, because one matrix leg can now fail
silently but the rest still gate.

- Code: `packages/core/src/rules/W.ts`, the W002 rule (search for `continue-on-error`).
- Done when: a positive case with a matrix expression reports W002 low `conditional`; an expression on a
  non test step stays quiet; `continue-on-error: false` stays quiet.

## 2. W003: test failures ignored in a shell script the workflow calls

W003 reads workflow files and build files. Many repositories run tests through a script, for example
`run: ./scripts/ci/test.sh`, and the suppression (`|| true`, `-Dmaven.test.failure.ignore=true`,
`set +e` before the test command) is added inside that script. Read changed `*.sh` files and report
the same suppressors W003 already knows when a test command line gains one.

- Code: `packages/core/src/rules/W.ts` (`isCommandFile`, `INLINE_SUPPRESSORS`, `isTestCommandLine`),
  `packages/core/src/diff/classify.ts` if a new file class helps.
- Done when: `pytest || true` added in a changed `.sh` file is reported; `|| true` after a non test
  command in the same script stays quiet; a comment line stays quiet.

## 3. W003: `|| true` in appveyor.yml and .gitlab-ci.yml

Same suppressors as W003, in two CI files the rule does not read yet: `appveyor.yml`
(`test_script:` entries) and `.gitlab-ci.yml` (`script:` entries).

- Code: `packages/core/src/rules/W.ts`, `packages/core/src/diff/classify.ts` (`ci-workflow` globs).
- Done when: one positive and one negative case per file type; existing GitHub Actions cases unchanged.

## 4. R003: a skip call inside an `if` at the top of a Python test

`self.skipTest(...)`, `pytest.skip(...)` and `raise unittest.SkipTest` are recognised as skips when
they are the first statement of the body. When the first statement is `if <condition>:` whose body is
only the skip call, the test is conditionally skipped. Report it as a conditional skip (R003 low,
label `conditional`), and as an unconditional skip when the condition folds to `True`.

- Code: `packages/lang-python/src/inventory.ts` (first statement skip detection),
  `packages/lang-python/src/frameworks.ts` (`skipCalls`).
- Done when: unit tests for `if sys.platform == "win32": self.skipTest(...)` (conditional) and
  `if True: pytest.skip()` (constant); a golden case in `fixtures/py-pytest` and one in
  `fixtures/py-unittest`.

## 5. R001: tests declared through a project wrapper function

Some TypeScript projects declare tests through their own helper, for example
`integTest('deploys a stack', async () => { ... })`, which wraps `test`. Deleting such a test is not
reported today. Add a config key `tests.wrappers: [integTest]` that makes the TypeScript front end
treat calls to those names as test declarations.

- Code: `packages/core/src/config.ts` (new key, documented in `docs/configuration.md`),
  `packages/lang-ts/queries/tests.scm` or `packages/lang-ts/src/inventory.ts`.
- Done when: with the key set, deleting a wrapped test reports R001; without the key nothing changes.

## 6. Comment: link each finding to its rule documentation

The PR comment shows the rule id (`R001`) in each row. A tired reviewer wants to know what it means
without leaving the PR. Make the rule id a link to its section on the docs site
(`https://testwitness.github.io/testwitness/rules#r001-...`). The anchor must match what VitePress
generates for the heading in `docs/rules.md`.

- Code: `packages/core/src/report/markdown.ts`, `scripts/gen-docs.ts` (headings).
- Done when: a unit test checks the link for every built in rule against the generated headings.

## 7. CLI: `testwitness explain <RULE>`

The MCP server has `testwitness_explain_rule`; the CLI only has `testwitness rules`. Add
`testwitness explain R001` printing the rule's name, default severity, summary, false positive
controls and example diff, from the same catalogue.

- Code: `packages/cli/src/index.ts` (commands), `packages/cli/src/mcp.ts` (reuse its formatter).
- Done when: unit test for a known id and for an unknown id (non zero exit, helpful message);
  `docs/cli.md` updated.

## 8. Fixture: Vitest `describe.each` titles in JUnit XML

The Vitest JUnit reporter writes `describe.each` titles with the substituted values. Produce real XML
by running Vitest on a small `describe.each` test in `fixtures/ts-vitest/project`, record the version and
command in the `PRODUCER.md`, and add V003 cases (all ran, one missing) that prove the name join works.

- Code: none expected; if the join fails, the fix is in `packages/junit/src/normalise.ts` or
  `packages/core/src/evidence/normalise.ts`.
- Done when: two golden cases pass on the real XML.

## 9. Java: `@Disabled` on a whole test class

`@Disabled` on a class disables every test in it. Check that R003 reports each test (or one finding for
the class with the count), and that moving `@Disabled` from the class to one method reports only that
method. Add the cases for JUnit 5, and `@Ignore` on a class for JUnit 4.

- Code: `packages/lang-java/src/inventory.ts` (class level markers), `packages/lang-java/queries/markers.scm`.
- Done when: golden cases in `fixtures/java-junit5-maven` and `fixtures/java-junit4-gradle`.

## 10. Python test files named outside the default globs

Some projects name test files `*_test_it.py` or keep tests in `it/` directories. The default globs
miss them. The `paths.tests` config key already exists; document it with this example in
`docs/configuration.md`, and add a case where a project sets it and a deleted test in
`integration/orders_test_it.py` is reported.

- Code: `packages/core/src/diff/classify.ts`, `docs/configuration.md`.
- Done when: the docs example is tested by a golden case (put a `.testwitness.yml` in the case's
  `base/` and `head/` trees; the engine reads it from the repository).
