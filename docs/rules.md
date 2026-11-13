# Rules reference

Generated from the rule definitions in `packages/core/src/rules`. Do not edit by hand; run `pnpm gen:docs`.

## R001 Test function deleted

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A test present in the base is absent in the head and no test with the same body exists elsewhere in the head tree.

**False positive controls.** Renamed tests with the same body are not reported. Reported low with a label when the test was moved to another file (same body, same name added elsewhere in the PR, or same name in a file with the same name in another directory), folded into a parameterised test whose case count covers the removed tests, rewritten (other changed test files gained at least as many tests as the PR deleted), replaced (its class or group gained as many new tests as it lost) or refactored (every assertion survives in a changed file). Reported low with the label production removed when its production file was deleted, or when a class or function the test names was removed from a production file that stays (and is defined in no other changed file). Reported low with the label version dropped when the test was gated on a language version (skipif on sys.version_info, process.versions, @EnabledOnJre) and the PR raises the minimum version (requires-python, python_requires, engines.node, the Java release). Precision over recall: a deletion is medium or high only when none of those signals is present.

**With run history.** A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with one of the labels moved, parameterised, rewritten, replaced, refactored, production removed or version dropped are left alone, because the test still runs somewhere or only partly stopped running. See [run history](history.md).

```diff
-  @Test
-  void rejectsNegativeAmount() {
-    assertThrows(IllegalArgumentException.class, () -> svc.charge(-1));
-  }
```

## R002 Test file deleted

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A file matching test patterns was deleted. The number of tests lost is counted from the base inventory.

**False positive controls.** A file whose tests all reappear elsewhere in the head tree is reported low as moved: same bodies anywhere, or the same test names in a file with the same name in another directory (a class moved to another package with edits, which git sees as a deletion and an addition). Same names in a file with another name are not a move. A file deleted while new test files the PR adds in the same directory hold at least as many tests as the PR deleted is reported low as rewritten, a narrower form of the control R001 applies. Reported low with the label production removed when the production file was deleted too, or when every test names a class or function the PR removed from a production file that stays, and low with the label version dropped when every test was gated on a language version the PR stops supporting. Git rename detection handles pure moves before this rule runs.

```diff
deleted file mode 100644 src/__tests__/billing.test.ts
```

## R003 Test newly skipped or disabled

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A skip, todo or fixme marker was added to a test that ran in the base.

**False positive controls.** Conditional skips whose condition is not a constant (platform or optional dependency checks) are reported low. A reason that references an issue number or tracker URL lowers the severity one step.

**With run history.** A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with the label conditional are left alone, because the test still runs somewhere or only partly stopped running. A skip whose reason references an issue (label tracked) on a test the history records as flaky (it passed and failed within the last 20 runs, or reran in at least 2 of them) keeps its severity and gets the label flaky in history, and the message states the counts. A skip of a flaky test without an issue reference is unchanged. See [run history](history.md).

```diff
+  @pytest.mark.skip(reason="flaky in CI")
   def test_batches(n):
```

## R004 Test converted to expected failure

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

An xfail, expectedFailure, test.fails or test.fail marker was added to a test that was expected to pass in the base.

**False positive controls.** A strict xfail with a reason that references an issue is lowered to medium: the failure is documented and will fail the suite once fixed.

**With run history.** A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with the label conditional or one case are left alone, because the test still runs somewhere or only partly stopped running. See [run history](history.md).

```diff
+  @pytest.mark.xfail(reason="see later")
   def test_rounding():
```

## R005 Focused test added

Default severity: high. Since 0.1.0. Languages: typescript, javascript. Needs: diff, ast.

A .only, fit or fdescribe focus marker is present on a test in the head and was not there in the base. Every other test in the file is silently not run.

**False positive controls.** Almost none in a pull request. Vitest refuses .only in CI unless allowOnly is set; Jest and Playwright do not.

```diff
-  it('rejects expired cards', async () => {
+  it.only('rejects expired cards', async () => {
```

## R006 Test body emptied or commented out

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A test that had executable statements in the base has none in the head (only pass, return, comments or a TODO). It will report as passing while testing nothing.

**False positive controls.** Java methods without a test annotation and Python functions the runner does not collect are not tests and are ignored by the front end.

```diff
   def test_refund_updates_ledger(client):
-      resp = client.post("/refund", json={"id": 7})
-      assert resp.status_code == 200
+      pass  # TODO restore after ledger refactor
```

## R010 Test added then skipped

Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A test new in this PR already carries a skip, todo, fixme or xfail marker. It is honest about not running but it is not coverage.

**False positive controls.** Informational by design. It rises to medium when the PR text claims the test as coverage; a ticked checklist box from a PR template is not such a claim. Classes under src/main are never run as tests by Maven or Gradle and are not reported (skipping samples that other tests use as input).

```diff
+  test.fixme('handles 3DS challenge', async ({ page }) => {
```

## A001 Assertion removed

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A modified test lost one or more assertions and gained no replacement on the same subject.

**False positive controls.** Consolidation of several assertions into one on the same subject (toEqual on an object, assertAll), and message asserts folded into a new match= on pytest.raises, are reported low as consolidated. A reduction matched by an increase in another test of the same class or describe block is reported low as assertions moved. Assertions moved into a helper are still counted when the helper is defined in the same file, or in a test support file of the checkout that contains an assertion (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test; a helper that calls another helper that asserts counts too). Such a replacement, for example inline asserts turned into result.did_create(path) with did_create defined in tests/lib, is a helper extraction and is silent. When the test gained at least as many new call statements as it lost assertions and none of them resolves to a helper with an assertion (a callee name not called anywhere in the base body, not a print, log or sleep call), the helper is outside the scanned locations, not on disk, or does not assert in a way the front end reads (a plain throw): the finding drops one step (medium to low, high to medium) and is labelled replaced by call with the first new callee in the message.

```diff
   expect(res.status).toBe(200);
-  expect(res.body.total).toBe(1250);
-  expect(ledger.entries).toHaveLength(2);
```

## A002 Assertion loosened

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

An assertion on a subject was replaced by a weaker one. Every assertion is read onto one lattice shared by all languages: exact equality and snapshots at the top, then ordered or near equality (startsWith, an anchored regex, containsExactlyInAnyOrder, closeTo), then containment (toContain, contains, in, toMatchObject, hasItem, an unanchored regex), then a bound (greaterThan, &gt;=, toBeLessThan), then a non empty check (greater than zero, not equal to zero, isNotEmpty), and at the bottom existence or truthiness (assertNotNull, toBeDefined, is not None, assertTrue on a plain value). Mock, exception and other library specific checks keep the strength their front end gives them. Base and head assertions are paired by subject: the same text first, then the same subject once identity accessors (length, size(), len(), trim(), get()), copies with a few fields overridden and boolean wrappers are removed, so assertTrue(body.contains(x)) is a containment check on body and all(d.get(k) == v for k, v in e.items()) is a subset check on d. A local name bound once to a projection of another reference is followed to that reference.

**False positive controls.** Textually unchanged assertions pair first and are never compared. A negative check (not equal, not in) is never paired with a positive one, except that not equal to zero reads as a lower bound and not equal to null as an existence check. An assertion that got stronger, or moved between spellings of the same rank (is(equalTo(x)) to equalTo(x), assertEquals(true, c) to assertTrue(c)), is silent. Pairing by position happens only when the leftover assertions match one for one and each pair shares an identifier word in its subject, so a subject replaced by an unrelated one is not paired, and such a pairing is never more than medium. A move accompanied by a stronger assertion on a sub expression of the same subject is low and labelled narrowed. A loosening in a test that gained parameterised cases is low. A test yields at most one finding, the worst pair, naming the matcher before and after. Within one library family the v0.1 grading holds: two steps down, or landing on a smoke check, is high; otherwise a drop is medium, and it is high when the head checks nothing about the value (existence or truthiness) on the same subject, or when the test exercises a production file the PR changed (by name convention or import, as for A001). Checks inside a helper defined in the test file, or inside a project matcher (a Hamcrest matcher passed to a project method, an expectation object passed to a project toMatch), are compared the same way and capped at medium, labelled in helper or nested.

```diff
-  assertEquals(new BigDecimal("12.50"), invoice.total());
+  assertNotNull(invoice.total());
```

## A009 Tautological assertion

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

An assertion whose two operands are the same literal or the same expression (assertTrue(true), expect(x).toEqual(x), assert x == x) was added or replaced a real assertion.

**False positive controls.** expect(a).toEqual(a) written on purpose to exercise a custom equality. Rare; acknowledge it with a reason.

```diff
+  expect(response).toBeDefined();
+  expect(true).toBe(true);
```

## O001 New test without an assertion

Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A test added in this PR has no assertion: no framework assertion, no exception expectation, no snapshot, and no call to an assertion helper defined in the file, in a test support file of the checkout, or configured in assertions.extra.

**False positive controls.** Smoke tests named contextLoads, smoke or DoesNotThrow are reported low with the label smoke. Helpers whose body contains an assertion are counted as assertions, whether they are defined in the test file or in a test support file of the checkout (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test), and a helper that calls another helper that asserts counts too. Only helpers outside those locations, or without an assertion the front end can read inside, need assertions.extra. Assertions inside nested scopes of the test body (callbacks, lambdas, anonymous and local classes, inner functions) are counted. The default is low (informational): on public PRs half of the new tests without an assertion were intentional smoke tests (race tests, verbose output tests, does not throw tests), so a static rule cannot carry medium or high here. Raise it per repository with rules: { O001: medium } in .testwitness.yml. With mutation reports from the opt in mutation job (docs/mutation-on-request.md) the oracle is measured instead of guessed: when the changed production lines the test exercises carry mutants and none of them was killed, the finding is medium with the label measured weak; when the test itself killed a mutant on those lines (it notices a wrong result, for example through an exception), the finding is dropped. Which production files a test exercises comes from the coverage the mutation report records, or from the name and imports of the test file when it records none.

```diff
+  @Test
+  void processesBatch() {
+    service.process(batch);
+  }
```

## O002 New test with a smoke oracle only

Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A new test whose only assertions are existence or type checks (toBeDefined, assertNotNull, isNotNone, not.toThrow, assertDoesNotThrow) or a bare snapshot. It proves the code ran, not what it did.

**False positive controls.** A test that is meant as a smoke test. Reported low by default; medium when the PR text calls it a regression test. With mutation reports (docs/mutation-on-request.md) it is measured: medium with the label measured weak when no mutant on the changed lines the test exercises was killed, and dropped when the test itself killed one of them, because then the existence check is measured strong enough for the change.

```diff
+  it('computes the discount', () => {
+    expect(computeDiscount(cart)).toBeDefined();
+  });
```

## O006 New test file with no tests collected

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A new file that the test runner would collect (named the way the runner finds test files) defines no collectable test (wrong name prefix, missing @Test, describe without it). It reads as coverage and runs nothing.

**False positive controls.** Only files a runner collects by name are checked: *Test, Test*, *Tests, *TestCase and *IT classes in Java; test_*.py, *_test.py and tests.py in Python; *.test.* and *.spec.* scripts, scripts directly inside __tests__, and with Mocha scripts directly inside test/ in JavaScript and TypeScript; plus anything matching paths.tests. Helpers, listeners, samples, stubs and harnesses with other names, package-info.java, names starting with an underscore, *.fixture.* files and anything under __fixtures__, fixtures, __mocks__, __snapshots__ or samples directories are support code and never reported. A collected script that declares no test but makes a top level call to a project function (such as runFormatTest(import.meta, [...])) generates its tests at run time and is reported low with the label generated.

```diff
+// tests/helpers.test.ts
+export function makeUser() { ... }
```

## M001 Changed lines with surviving mutants

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, mutation.

Mutation reports of the head (Stryker JSON or PIT mutations.xml, from the opt in mutation job; the mutation input, --mutation or mutation.paths) say that lines this PR added or changed in a production file carry mutants that no test killed: every mutant starting on the line survived or was not covered. One finding per file with the count and the first three line numbers, label measured weak. Medium when at least 3 such lines, or more than half of the mutated changed lines, are weak; low otherwise. Nothing is reported without mutation reports.

**False positive controls.** Only lines with at least one mutant that ran to an outcome count; compile errors, runtime errors, ignored and pending mutants are not counted, and a timed out mutant counts as killed. A mutant is attributed to the line it starts on, so a removed block is counted on the line of its opening brace. Equivalent mutants (a change no test could observe, such as &gt;= against &gt; on a value the code never reaches) survive by nature; one weak line in a well tested file stays low. Reports from a run that mutated other files than the PR changed say nothing about the changed lines and give no finding. At most 200 changed production files are checked and at most 200 report files or 50 MB are read.

```diff
src/shipping.ts: 4 changed lines have mutants that no test killed (lines 3, 4, 6 and 1 more): 6 survived, 6 not covered.
```

## M002 New test kills nothing

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast, mutation.

A test added in this PR appears in no killing test list of the mutation reports, although the reports name the tests that killed mutants (Stryker killedBy with testFiles, PIT killingTest or killingTests). The test ran under mutation and noticed none of the changes. High when the test exercises a changed production file with mutants (by the coverage the report records, or by name and imports when it records none); medium otherwise. Label measured weak.

**False positive controls.** Silent when the reports name no killing tests, with a note in the mutation section of the report. When a Stryker report lists the tests of the run (testFiles), a new test it does not list did not run under mutation and gets no finding. A test that only checks that nothing throws can still kill a mutant that throws; that counts as a kill. PIT stops at the first killing test of a mutant unless fullMutationMatrix is on, so a test whose every kill was also made by an earlier test can look like it kills nothing; turn fullMutationMatrix on in the mutation job to rule that out. Skipped and expected failure tests are not reported.

```diff
+it('returns text for euros', () => {
+  expect(typeof money(5, '€')).toBe('string');
+});
```

## E001 Catch all added in a test

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A try block now wraps part of the test and its catch (Exception, Throwable, bare except, any JavaScript catch, or .catch(() =&gt; {})) neither rethrows, fails nor asserts. A failing subject call no longer fails the test.

**False positive controls.** Cleanup wrappers with finally only are not catches. Catch blocks that assert on the exception, call fail(), or rethrow are not reported. Capture then assert is not reported either: a catch that stores the error in a variable the test asserts on after the try block, and `.catch((e) =&gt; e)` whose result is stored and asserted. A promise left running on purpose (`void call().catch(() =&gt; {})` as its own statement, with assertions after it) is reported low with the label background. A catch that existed in the base is not reported.

```diff
+  try {
+    svc.reconcile(ledger);
+    assertEquals(0, ledger.drift());
+  } catch (Exception e) {
+    // ignore transient failures
+  }
```

## W002 continue-on-error added to a test step or job

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow.

A GitHub Actions workflow gained continue-on-error: true on a step whose run command is a test command, or on a job that runs one. The job stays green when the tests fail.

**False positive controls.** continue-on-error on a non test step (uploads, linters, optional checks) is not reported. The step is found by scanning the head file for the nearest run: line after the added key in the same step, and the job by the job that contains a test command.

```diff
       - name: Unit tests
+        continue-on-error: true
         run: ./gradlew test
```

## W003 Failure suppressed in the run command

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow, config.

A test command in a workflow, package.json script, Makefile, tox.ini, Jenkinsfile or build file gained a construct that hides its exit code (|| true, || exit 0, -DskipTests, testFailureIgnore, ignoreFailures, set +e, a pipe to tail without pipefail).

**False positive controls.** || true on a non test command in the same script. The suppressor must sit on the same line as the test command, or be a set +e in the same hunk ahead of it. A line that merely moved within the file is not reported.

```diff
-        run: pytest -q
+        run: pytest -q || true
```

## W006 The integrity gate itself weakened

Default severity: high. Since 0.1.0. Languages: all. Needs: diff.

The PR changes .testwitness.yml or the workflow step that runs testwitness (its version, inputs, mode or fail_on). Configuration is read from the base ref, so the change takes effect only after merge; this finding makes sure a maintainer sees it. It cannot be acknowledged by the PR author or by the label.

**False positive controls.** Legitimate configuration changes. A maintainer acknowledges them with the comment command, and the change applies after merge.

```diff
 rules:
-  R003: high
+  R003: off
```

## S004 Snapshot update enabled in the test command

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow, config.

The test command or runner config now rewrites snapshots on every run (jest -u, --updateSnapshot, --ci=false, UPDATE_SNAPSHOTS=1, syrupy --snapshot-update, Playwright --update-snapshots, ApprovalTests --approve), so a changed snapshot can never fail.

**False positive controls.** A separate, clearly named script such as "test:update" that is not the CI test command. Reported for any script line; acknowledge the update script once.

```diff
-    "test": "jest --ci",
+    "test": "jest -u",
```

## C001 Test selection narrowed in config

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, config.

Runner configuration now selects fewer tests. pytest addopts gaining --ignore, --ignore-glob, --deselect or -k, testpaths narrowed, norecursedirs grown; Jest testPathIgnorePatterns or modulePathIgnorePatterns grown, testMatch or testRegex narrowed; Vitest test.include narrowed or test.exclude grown; Mocha spec narrowed or ignore grown in .mocharc; Playwright testIgnore grown or testMatch narrowed; Surefire or Failsafe &lt;excludes&gt; or &lt;excludedGroups&gt; grown, &lt;includes&gt; narrowed; Gradle test exclude(...), filter excludeTestsMatching, useJUnitPlatform excludeTags (and excludeCategories, excludeGroups) grown; TestNG suite &lt;exclude&gt; grown; junit.jupiter.conditions.deactivate set in junit-platform.properties (medium). Path patterns are matched against the test files of the head tree and the finding names how many it drops. Test tasks disabled outright (&lt;skipTests&gt;, &lt;skip&gt;, test { enabled = false }) are reported by W003.

**False positive controls.** An exclusion of a generated or installed directory (node_modules, dist, build, target, .venv and the like) is silent. An exclusion whose pattern matches no test file in the head tree is low with the label matches nothing. An include pattern replaced by others that still cover every test file it matched is silent. The same pattern removed from the same setting in another file of the PR (a config moved from package.json to jest.config.js) is silent. Tags, groups, -k expressions and TestNG method excludes cannot be matched to files and stay high, as do regular expressions that could backtrack without bound (nested or alternated repetition, backreferences, more than three unbounded repeats), which are not run. A changed config file over 1 MB is not read and is reported high with the label too large.

```diff
   testPathIgnorePatterns: [
     "/node_modules/",
+    "<rootDir>/src/payments/",
   ],
```

## C002 Coverage threshold lowered or removed

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, config.

A coverage gate got weaker: a threshold was lowered (medium) or removed (high). Read as config text and compared as numbers between base and head: Jest coverageThreshold (jest.config.*, package.json jest), Vitest coverage.thresholds, nyc check-coverage values (.nycrc, package.json nyc), pytest --cov-fail-under in addopts (pytest.ini, setup.cfg, tox.ini, pyproject.toml), coverage.py fail_under (.coveragerc, [coverage:report], [tool.coverage.report]), JaCoCo limits in pom.xml and Gradle violationRules, Kover minBound and minValue, codecov.yml target and threshold, and .coveralls.yml thresholds. For an allowed drop (codecov threshold, a JaCoCo maximum, a coveralls decrease threshold) a higher value is the weaker one.

**False positive controls.** A threshold moved to another file in the same PR (or to another setting in the same file, such as --cov-fail-under to fail_under) with the same or a stricter value is silent. A new project with its own threshold is not a lowering, because only settings present in the base are compared. Removing an allowed drop (codecov threshold) is stricter and is not reported. Values that are not literal numbers (codecov auto, a variable) are not read. A changed config file over 1 MB is not read and is reported high with the label too large.

```diff
   coverageThreshold: {
-    global: { lines: 90, branches: 80 },
+    global: { lines: 70, branches: 80 },
   },
```

## C003 Passing with no tests enabled

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, config, workflow.

A test command, script, workflow or runner config now passes when no test is found: --passWithNoTests or passWithNoTests: true (Jest, Vitest), Playwright --pass-with-no-tests, Surefire or Failsafe &lt;failIfNoTests&gt;false&lt;/failIfNoTests&gt; or -DfailIfNoTests=false, Gradle failOnNoDiscoveredTests = false or filter.failOnNoMatchingTests = false, pytest --suppress-no-test-exit-code. A typo in a path or a filter then turns the whole test run into a green no op.

**False positive controls.** The same setting already present anywhere in the base version of the file is silent, and so is a line that only moved within the file. Commented out lines are ignored.

```diff
-    "test": "jest",
+    "test": "jest --passWithNoTests",
```

## V003 Changed test did not run

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast, junit.

A test added or modified by the PR has no record in the test results of this run (JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright). Names are normalised across Surefire, Gradle, pytest, jest-junit, Vitest, Playwright, Mocha and Node test runner producers.

**False positive controls.** Tests in a matrix leg whose results were not uploaded; parametrised or dynamic names the normaliser missed. When no test from the same file ran the finding is medium with the label file not in results. When fewer than half of the changed test files appear in the results at all, every finding in this group is low with the label partial results.

**With run history.** A finding on a test recorded in every one of the last 5 runs of the history becomes high with the label ran before, not now. A test the history has never seen, or that is missing from any of those 5 runs, keeps the severity above, and a finding labelled partial results stays low. A history with fewer than 5 runs changes nothing. See [run history](history.md).

```diff
Modified test CartTest#handlesEmpty has no testcase record in 3 result files (42 tests).
```

## V004 Claim in PR text not supported by results

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast, prtext.

The PR title or body claims that tests pass, that tests were added, or that nothing changed in tests, and the diff or the attached results do not support it. Claims that cannot be checked are reported as unreadable (low), never as false.

**False positive controls.** Claims inside code blocks and HTML comments and every checklist line, checked or not, are template text and stripped ("- [x] Add test case(s)" ticks a reminder). Negated claims are skipped, including a negation later on the same line ("Added tests: not applicable", "no new test"). An "added tests" claim is supported by a new test, by new rows in a parameter table (test.each, parametrize), by new entries in a snapshot file (fixture driven suites such as runFormatTest generate their tests from input files) and by two or more new assertions inside existing tests. Wording is always "not supported by the results attached to this run".

```diff
PR body says "all tests pass"; results show 2 failures.
```

## V005 No test results found

Default severity: low. Since 0.1.0. Languages: all. Needs: diff.

The PR touches tests or test configuration and no test results were found. The evidence section reads unreadable and changed tests cannot be checked against what ran.

**False positive controls.** None: this is an instruction to add a reporter (JUnit XML first: --junitxml, jest-junit, the Playwright junit reporter, Surefire writes it by default; TAP and the Jest, Vitest, pytest-json-report and Playwright JSON reporters are read too).

```diff
No test results matched **/junit*.xml.
```

## V006 Failures in results while the PR claims passing

Default severity: high. Since 0.1.0. Languages: all. Needs: junit, prtext.

The attached results contain failures or errors and the PR text claims the tests pass.

**False positive controls.** Results from a different run than the one the author describes. Attach the XML from the head commit.

```diff
PR body: "all tests pass". junit.xml: 3 failures.
```

## V008 Changed production lines not executed

Default severity: low. Since 0.1.0. Languages: all. Needs: diff, coverage.

Coverage reports of the head run (lcov, Cobertura such as coverage.py coverage.xml, JaCoCo XML; the coverage input, --coverage or coverage.paths) say that lines this PR added or changed in a production file were instrumented but never executed by any test. One finding per file with the count and the first three line numbers, label uncovered change. Nothing is reported when no coverage report is attached.

**False positive controls.** Only lines the coverage tool instrumented count, so comments, blank lines, declarations and files missing from the report are never reported. Reports from a partial run (one matrix leg, a sharded suite) under count execution; attach every shard. At most 200 changed production files are checked and at most 200 report files or 50 MB of coverage data are read.

```diff
src/billing/refund.py: 4 changed lines never executed by the tests (lines 42, 43, 57 and 1 more).
```
