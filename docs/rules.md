# Rules reference

Generated from the rule definitions in `packages/core/src/rules`. Do not edit by hand; run `pnpm gen:docs`.

v0.1 reports only the proven rules at medium or high: A002, R003, R004, R005. Every other rule still runs, but its findings are capped at low (informational) until it passes an untuned replay, and the report keeps the severity the rule gave in `uncappedSeverity`. W006, the gate protecting itself, is the one exception. The default severity below is what the rule itself says. A repository can opt a rule back in by naming its severity in `.testwitness.yml`, for example `rules: { R001: medium }`. See [how we measure precision](how-we-measure-precision.md).

## R001 Test function deleted

Not proven yet: reported at low unless the repository opts it in. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A test present in the base is absent in the head and no test with the same body exists elsewhere in the head tree.

**False positive controls.** Renamed tests with the same body are not reported. Reported low with a label when the test was moved to another file (same body, same name added elsewhere in the PR, or same name in a file with the same name in another directory), folded into a parameterised test whose case count covers the removed tests, rewritten (other changed test files gained at least as many tests as the PR deleted), replaced (its class or group gained as many new tests as it lost) or refactored (every assertion survives in a changed file). Reported low with the label renamed when a new test of the same file shares at least 80 percent of its tokens in order (test names ignored, at least 20 tokens), and low as replaced when its class or describe block is gone from the head and the groups that are new in the same file hold at least as many new tests as the vanished groups lost (a group renamed and its tests rewritten in place). A test whose class or group was renamed keeps its pairing by its own name when exactly one test on each side carries that name. Reported low with the label production removed when its production file was deleted, when a class or function the test names was removed from a production file that stays (and is defined in no other changed file; a definition commented out line by line counts as removed), when the test, or a helper of the test file that went away with it, uses a name the PR removed from the production code (a method, field, config key or import bound in the base of a changed production file and mentioned in the head of none), or when it uses a name its file imported from a module the PR deletes. A name the test only declares itself does not count. Reported low with the label near duplicate removed when a test that stays in the same file or in another changed test file contains the deleted test token for token (whitespace, comments and the test names ignored, string literals compared without letter case, at most one literal differing only in case), is at most half as long again, and adds only checks (each run of added tokens holds expect, assert, should, verify or a toBe style matcher): the same setup and checks still run. A deleted test that differs in any identifier, number or literal value, whose copy adds input (another event, argument or field) rather than a check, or that is shorter than 25 tokens, is not a near duplicate. Reported low with the label version dropped when the test was gated on a language version (skipif on sys.version_info, process.versions, @EnabledOnJre) and the PR raises the minimum version (requires-python, python_requires, engines.node, the Java release). Precision over recall: a deletion is medium or high only when none of those signals is present.

```diff
-  @Test
-  void rejectsNegativeAmount() {
-    assertThrows(IllegalArgumentException.class, () -> svc.charge(-1));
-  }
```

## R002 Test file deleted

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A file matching test patterns was deleted. The number of tests lost is counted from the base inventory.

**False positive controls.** A file whose tests all reappear elsewhere in the head tree is reported low as moved: same bodies anywhere, or the same test names in a file with the same name in another directory (a class moved to another package with edits, which git sees as a deletion and an addition). Same names in a file with another name are not a move. A file deleted while new test files the PR adds in the same directory, or a new file with the same name elsewhere, hold at least as many tests as the deleted file is reported low as rewritten, a narrower form of the control R001 applies. Reported low with the label production removed when the production file was deleted too, or when every test names a class or function the PR removed from a production file that stays, and low with the label version dropped when every test was gated on a language version the PR stops supporting. Git rename detection handles pure moves before this rule runs.

```diff
deleted file mode 100644 src/__tests__/billing.test.ts
```

## R003 Test newly skipped or disabled

Proven: reported at the severity below. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A skip, todo or fixme marker was added to a test that ran in the base.

**False positive controls.** Conditional skips whose condition is not a constant (platform or optional dependency checks) are reported low. A reason that references an issue number or tracker URL lowers the severity one step.

```diff
+  @pytest.mark.skip(reason="flaky in CI")
   def test_batches(n):
```

## R004 Test converted to expected failure

Proven: reported at the severity below. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

An xfail, expectedFailure, test.fails or test.fail marker was added to a test that was expected to pass in the base.

**False positive controls.** A strict xfail with a reason that references an issue is lowered to medium: the failure is documented and will fail the suite once fixed.

```diff
+  @pytest.mark.xfail(reason="see later")
   def test_rounding():
```

## R005 Focused test added

Proven: reported at the severity below. Default severity: high. Since 0.1.0. Languages: typescript, javascript. Needs: diff, ast.

A .only, fit or fdescribe focus marker is present on a test in the head and was not there in the base. Every other test in the file is silently not run.

**False positive controls.** Almost none in a pull request. Vitest refuses .only in CI unless allowOnly is set; Jest and Playwright do not.

```diff
-  it('rejects expired cards', async () => {
+  it.only('rejects expired cards', async () => {
```

## R006 Test body emptied or commented out

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A test that had executable statements in the base has none in the head (only pass, return, comments or a TODO). It will report as passing while testing nothing.

**False positive controls.** Java methods without a test annotation and Python functions the runner does not collect are not tests and are ignored by the front end.

```diff
   def test_refund_updates_ledger(client):
-      resp = client.post("/refund", json={"id": 7})
-      assert resp.status_code == 200
+      pass  # TODO restore after ledger refactor
```

## R010 Test added then skipped

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A test new in this PR already carries a skip, todo, fixme or xfail marker. It is honest about not running but it is not coverage.

**False positive controls.** Informational by design. It rises to medium when the PR text claims the test as coverage; a ticked checklist box from a PR template is not such a claim. Classes under src/main are never run as tests by Maven or Gradle and are not reported (skipping samples that other tests use as input).

```diff
+  test.fixme('handles 3DS challenge', async ({ page }) => {
```

## A001 Assertion removed

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A modified test lost one or more assertions and gained no replacement on the same subject.

**False positive controls.** Consolidation of several assertions into one on the same subject (toEqual on an object, assertAll), and message asserts folded into a new match= on pytest.raises, are reported low as consolidated. An assertion removed from inside an exception expectation that stays (the block of pytest.raises or assertRaises, the callable of assertThrows or assertThatThrownBy, the function given to expect(fn).toThrow(TypeError)) is reported low with the label inside exception expectation: the code raises before such an assertion is evaluated, so the expectation is the oracle. This does not apply when the expected type is one an assertion failure satisfies (AssertionError, Exception, Error, Throwable, a bare toThrow()). A reduction matched by an increase in another test of the same class or describe block is reported low as assertions moved. A lost assertion that names something this PR removed from the production code (a class, function, method, field or config key that no changed production file mentions any more, or a name the test file imported from a module the PR deletes) and that the head of the test file no longer uses is reported low with the label production removed. A lost never called check (not.toHaveBeenCalled, assert_not_called, verify with never()) on a test double that the head of the test file no longer mentions at all is reported low with the label double removed: the double, its setup and its checks went away together because the code under test no longer reaches that dependency. Assertions moved into a helper are still counted when the helper is defined in the same file, or in a test support file of the checkout that contains an assertion (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test; a helper that calls another helper that asserts counts too). Such a replacement, for example inline asserts turned into result.did_create(path) with did_create defined in tests/lib, is a helper extraction and is silent. When the test gained at least as many new call statements as it lost assertions and none of them resolves to a helper with an assertion (a callee name not called anywhere in the base body, not a print, log or sleep call), the helper is outside the scanned locations, not on disk, or does not assert in a way the front end reads (a plain throw): the finding is low and is labelled replaced by call with the first new callee in the message. A001 ships at low (informational) by default until its measured precision improves: when this default was set (13 November 2026), its precision on medium and high findings on the held out half of the corpus was 0.29, and 1 of its 4 findings in the 300 PR real world trial was true. A finding on a test that exercises a production file the PR changed (by name convention or import) is raised to medium. Raise it per repository with rules: { A001: medium } in .testwitness.yml.

```diff
   expect(res.status).toBe(200);
-  expect(res.body.total).toBe(1250);
-  expect(ledger.entries).toHaveLength(2);
```

## A002 Assertion loosened

Proven: reported at the severity below. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

An assertion on a subject was replaced by a weaker one. Every assertion is read onto one lattice shared by all languages: exact equality and snapshots at the top, then ordered or near equality (startsWith, an anchored regex, containsExactlyInAnyOrder, closeTo), then containment (toContain, contains, in, toMatchObject, hasItem, an unanchored regex), then a bound (greaterThan, &gt;=, toBeLessThan), then a non empty check (greater than zero, not equal to zero, isNotEmpty), and at the bottom existence or truthiness (assertNotNull, toBeDefined, is not None, assertTrue on a plain value). Mock, exception and other library specific checks keep the strength their front end gives them. Base and head assertions are paired by subject: the same text first, then the same subject once identity accessors (length, size(), len(), trim(), get()), copies with a few fields overridden and boolean wrappers are removed, so assertTrue(body.contains(x)) is a containment check on body and all(d.get(k) == v for k, v in e.items()) is a subset check on d. A local name bound once to a projection of another reference is followed to that reference.

**False positive controls.** Textually unchanged assertions pair first and are never compared. A check that kept its call, matcher and expected operand and only changed its subject stays paired with itself when its new subject is the subject of another base assertion that keeps an equally strong check in the head, so two unrelated assertions are not compared. Exact equality on both sides through the same call and matcher is never a loosening, even when a front end grades a literal above a computed expected value (== "1.0" turned into == spec["version"]). A base assertion that the subject has no value (toBeNull, toBeUndefined, assertIsNone, equality with null) replaced by a check that requires a value is a new expected value, not a loosening. A negative check (not equal, not in) is never paired with a positive one, except that not equal to zero reads as a lower bound and not equal to null as an existence check. An assertion that got stronger, or moved between spellings of the same rank (is(equalTo(x)) to equalTo(x), assertEquals(true, c) to assertTrue(c)), is silent. Pairing by position happens only when the leftover assertions match one for one and each pair shares an identifier word in its subject, so a subject replaced by an unrelated one is not paired, and such a pairing is never more than medium. A move accompanied by a stronger assertion on a sub expression of the same subject is low and labelled narrowed. A loosening in a test that gained parameterised cases is low. A test yields at most one finding, the worst pair, naming the matcher before and after. Within one library family the v0.1 grading holds: two steps down, or landing on a smoke check, is high; otherwise a drop is medium, and it is high when the head checks nothing about the value (existence or truthiness) on the same subject, or when the test exercises a production file the PR changed (by name convention or import, as for A001). Checks inside a helper defined in the test file, or inside a project matcher (a Hamcrest matcher passed to a project method, an expectation object passed to a project toMatch), are compared the same way and capped at medium, labelled in helper or nested.

```diff
-  assertEquals(new BigDecimal("12.50"), invoice.total());
+  assertNotNull(invoice.total());
```

## A009 Tautological assertion

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

An assertion whose two operands are the same literal or the same expression (assertTrue(true), expect(x).toEqual(x), assert x == x) was added or replaced a real assertion.

**False positive controls.** expect(a).toEqual(a) written on purpose to exercise a custom equality. Rare; acknowledge it with a reason. Ships at low (informational) by default until its measured precision improves: when this default was set (13 November 2026), its precision on medium and high findings on the held out half of the corpus was 0.00, and its 1 finding in the 300 PR real world trial was not true. Raise it per repository with rules: { A009: medium } in .testwitness.yml.

```diff
+  expect(response).toBeDefined();
+  expect(true).toBe(true);
```

## O001 New test without an assertion

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A test added in this PR has no assertion: no framework assertion, no exception expectation, no snapshot, and no call to an assertion helper defined in the file, in a test support file of the checkout, or configured in assertions.extra.

**False positive controls.** Smoke tests named contextLoads, smoke or DoesNotThrow are reported low with the label smoke. Helpers whose body contains an assertion are counted as assertions, whether they are defined in the test file or in a test support file of the checkout (the helper index: files under test, tests, __tests__, spec, testing, test-utils, testutils or fixtures directories, conftest.py, src/test), and a helper that calls another helper that asserts counts too. Only helpers outside those locations, or without an assertion the front end can read inside, need assertions.extra. Assertions inside nested scopes of the test body (callbacks, lambdas, anonymous and local classes, inner functions) are counted. The default is low (informational): on public PRs half of the new tests without an assertion were intentional smoke tests (race tests, verbose output tests, does not throw tests), so a static rule cannot carry medium or high here. Raise it per repository with rules: { O001: medium } in .testwitness.yml.

```diff
+  @Test
+  void processesBatch() {
+    service.process(batch);
+  }
```

## O002 New test with a smoke oracle only

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A new test whose only assertions are existence or type checks (toBeDefined, assertNotNull, isNotNone, not.toThrow, assertDoesNotThrow) or a bare snapshot. It proves the code ran, not what it did.

**False positive controls.** A test that is meant as a smoke test. Reported low by default. The PR text does not raise it: a description that speaks of regression tests says nothing about the oracle of one test, and on 300 pull requests of unseen repositories none of the findings it raised was true. A Python boolean assert is a smoke check only when its truth says that a value exists, has a type or is empty (assert x, assert not x, assert x is not None, assert isinstance(x, T), assert len(x)); a call relating two or more arguments (assert has_edge(graph, a, b)), a function named like a question (assert registry.is_open(name)), assert all(...) or any(...) over a condition, assert not any(...), assert not [x for x in rows if ...] and a comparison joined by and are value checks, and the same reading applies to assertTrue and assertFalse. Ships at low (informational) by default until its measured precision improves: when this default was set (13 November 2026), its precision on medium and high findings on the held out half of the corpus was 0.00, and neither of its 2 findings in the 300 PR real world trial was true. Raise it per repository with rules: { O002: medium } in .testwitness.yml.

```diff
+  it('computes the discount', () => {
+    expect(computeDiscount(cart)).toBeDefined();
+  });
```

## O006 New test file with no tests collected

Not proven yet: reported at low unless the repository opts it in. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A new file that the test runner would collect (named the way the runner finds test files) defines no collectable test (wrong name prefix, missing @Test, describe without it). It reads as coverage and runs nothing.

**False positive controls.** Only files a runner collects by name are checked: *Test, Test*, *Tests, *TestCase and *IT classes in Java; test_*.py, *_test.py and tests.py in Python; *.test.* and *.spec.* scripts, scripts directly inside __tests__, and with Mocha scripts directly inside test/ in JavaScript and TypeScript; plus anything matching paths.tests. Helpers, listeners, samples, stubs and harnesses with other names, package-info.java, names starting with an underscore, *.fixture.* files and anything under __fixtures__, fixtures, __mocks__, __snapshots__ or samples directories are support code and never reported. A collected script that declares no test but makes a top level call to a project function (such as runFormatTest(import.meta, [...])) generates its tests at run time and is reported low with the label generated.

```diff
+// tests/helpers.test.ts
+export function makeUser() { ... }
```

## E001 Catch all added in a test

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

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

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow.

A GitHub Actions workflow gained continue-on-error: true on a step whose run command is a test command, or on a job that runs one. The job stays green when the tests fail.

**False positive controls.** continue-on-error on a non test step (uploads, linters, optional checks) is not reported. The step is found by scanning the head file for the nearest run: line after the added key in the same step, and the job by the job that contains a test command.

```diff
       - name: Unit tests
+        continue-on-error: true
         run: ./gradlew test
```

## W003 Failure suppressed in the run command

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow, config.

A test command in a workflow, package.json script, Makefile, tox.ini, Jenkinsfile or build file gained a construct that hides its exit code (|| true, || exit 0, -DskipTests, testFailureIgnore, ignoreFailures, set +e, a pipe to tail without pipefail).

**False positive controls.** || true on a non test command in the same script. The suppressor must sit on the same line as the test command, or be a set +e in the same hunk ahead of it. A line that merely moved within the file is not reported.

```diff
-        run: pytest -q
+        run: pytest -q || true
```

## W006 The integrity gate itself weakened

The gate protecting itself: reported at the severity below, the one exception to the cap. Default severity: high. Since 0.1.0. Languages: all. Needs: diff.

The change touches the gate itself: .testwitness.yml, the workflow step that runs testwitness (its version, inputs, mode or fail_on), or the agent hook config that runs testwitness hook (.claude/settings.json, .claude/settings.local.json, .cursor/hooks.json, .codex/hooks.json, .codex/config.toml). Configuration is read from the base ref, so a config change takes effect only after merge; this finding makes sure a maintainer sees it. It cannot be acknowledged by the PR author or by the label.

**False positive controls.** Legitimate configuration changes. A maintainer acknowledges them with the comment command, and the change applies after merge. A hook config file is reported only when it mentions testwitness at the base or at the head, or when one of the hook config files at the base does (so a setting that turns every hook off is seen); a repository that does not use the agent hook gets no finding for its agent settings.

```diff
 rules:
-  R003: high
+  R003: off
```

## S004 Snapshot update enabled in the test command

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, workflow, config.

The test command or runner config now rewrites snapshots on every run (jest -u, --updateSnapshot, --ci=false, UPDATE_SNAPSHOTS=1, syrupy --snapshot-update, Playwright --update-snapshots, ApprovalTests --approve), so a changed snapshot can never fail.

**False positive controls.** A separate, clearly named script such as "test:update" that is not the CI test command. Reported for any script line; acknowledge the update script once.

```diff
-    "test": "jest --ci",
+    "test": "jest -u",
```

## C001 Test selection narrowed in config

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, config.

Runner configuration now selects fewer tests. pytest addopts gaining --ignore, --ignore-glob, --deselect or -k, testpaths narrowed, norecursedirs grown; Jest testPathIgnorePatterns or modulePathIgnorePatterns grown, testMatch or testRegex narrowed; Vitest test.include narrowed or test.exclude grown; Mocha spec narrowed or ignore grown in .mocharc; Playwright testIgnore grown or testMatch narrowed; Surefire or Failsafe &lt;excludes&gt; or &lt;excludedGroups&gt; grown, &lt;includes&gt; narrowed; Gradle test exclude(...), filter excludeTestsMatching, useJUnitPlatform excludeTags (and excludeCategories, excludeGroups) grown; TestNG suite &lt;exclude&gt; grown; junit.jupiter.conditions.deactivate set in junit-platform.properties (medium). Path patterns are matched against the test files of the head tree and the finding names how many it drops. Test tasks disabled outright (&lt;skipTests&gt;, &lt;skip&gt;, test { enabled = false }) are reported by W003.

**False positive controls.** An exclusion of a generated or installed directory (node_modules, dist, build, target, .venv and the like) is silent. An exclusion whose pattern matches no test file in the head tree is low with the label matches nothing. An include pattern replaced by others that still cover every test file it matched is silent. The same pattern removed from the same setting in another file of the PR (a config moved from package.json to jest.config.js) is silent. Tags, groups, -k expressions and TestNG method excludes cannot be matched to files and stay high, as do regular expressions that could backtrack without bound (nested or alternated repetition, backreferences, more than three unbounded repeats), which are not run. A changed config file over 1 MB is not read and is reported high with the label too large; a YAML, JSON or XML config nested deeper than 200 levels is not read either and is reported high with the label too deep.

```diff
   testPathIgnorePatterns: [
     "/node_modules/",
+    "<rootDir>/src/payments/",
   ],
```

## C002 Coverage threshold lowered or removed

Not proven yet: reported at low unless the repository opts it in. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, config.

A coverage gate got weaker: a threshold was lowered (medium) or removed (high). Read as config text and compared as numbers between base and head: Jest coverageThreshold (jest.config.*, package.json jest), Vitest coverage.thresholds, nyc check-coverage values (.nycrc, package.json nyc), pytest --cov-fail-under in addopts (pytest.ini, setup.cfg, tox.ini, pyproject.toml), coverage.py fail_under (.coveragerc, [coverage:report], [tool.coverage.report]), JaCoCo limits in pom.xml and Gradle violationRules, Kover minBound and minValue, codecov.yml target and threshold, and .coveralls.yml thresholds. For an allowed drop (codecov threshold, a JaCoCo maximum, a coveralls decrease threshold) a higher value is the weaker one.

**False positive controls.** A threshold moved to another file in the same PR (or to another setting in the same file, such as --cov-fail-under to fail_under) with the same or a stricter value is silent. A new project with its own threshold is not a lowering, because only settings present in the base are compared. Removing an allowed drop (codecov threshold) is stricter and is not reported. Values that are not literal numbers (codecov auto, a variable) are not read. A changed config file over 1 MB is not read and is reported high with the label too large; a YAML, JSON or XML config nested deeper than 200 levels is not read either and is reported high with the label too deep.

```diff
   coverageThreshold: {
-    global: { lines: 90, branches: 80 },
+    global: { lines: 70, branches: 80 },
   },
```

## C003 Passing with no tests enabled

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, config, workflow.

A test command, script, workflow or runner config now passes when no test is found: --passWithNoTests or passWithNoTests: true (Jest, Vitest), Playwright --pass-with-no-tests, Surefire or Failsafe &lt;failIfNoTests&gt;false&lt;/failIfNoTests&gt; or -DfailIfNoTests=false, Gradle failOnNoDiscoveredTests = false or filter.failOnNoMatchingTests = false, pytest --suppress-no-test-exit-code. A typo in a path or a filter then turns the whole test run into a green no op.

**False positive controls.** The same setting already present anywhere in the base version of the file is silent, and so is a line that only moved within the file. Commented out lines are ignored.

```diff
-    "test": "jest",
+    "test": "jest --passWithNoTests",
```

## V003 Changed test did not run

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast, junit.

A test added or modified by the PR has no record in the test results of this run (JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright). Names are normalised across Surefire, Gradle, pytest, jest-junit, Vitest, Playwright, Mocha and Node test runner producers.

**False positive controls.** Tests in a matrix leg whose results were not uploaded; parametrised or dynamic names the normaliser missed. When no test from the same file ran the finding is medium with the label file not in results. When fewer than half of the changed test files appear in the results at all, every finding in this group is low with the label partial results.

```diff
Modified test CartTest#handlesEmpty has no testcase record in 3 result files (42 tests).
```

## V004 Claim in PR text not supported by results

Not proven yet: reported at low unless the repository opts it in. Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast, prtext.

The PR title or body claims that tests pass, that tests were added, or that nothing changed in tests, and the diff or the attached results do not support it. Claims that cannot be checked are reported as unreadable (low), never as false.

**False positive controls.** Claims inside code blocks and HTML comments are stripped, and so is every unchecked checklist line. A checked checklist line is template text too ("- [x] Add test case(s)" ticks a reminder) and is read as an added tests claim only when the PR changes no test file at all. Negated claims are skipped, including a negation later on the same line ("Added tests: not applicable", "no new test"). An "added tests" claim is supported by a new test, by new rows in a parameter table (test.each, parametrize), by new entries in a snapshot file (fixture driven suites such as runFormatTest generate their tests from input files) and by two or more new assertions inside existing tests. Wording is always "not supported by the results attached to this run".

```diff
PR body says "all tests pass"; results show 2 failures.
```

## V005 No test results found

Not proven yet: reported at low unless the repository opts it in. Default severity: low. Since 0.1.0. Languages: all. Needs: diff.

The PR touches tests or test configuration and no test results were found. The evidence section reads unreadable and changed tests cannot be checked against what ran.

**False positive controls.** None: this is an instruction to add a reporter (JUnit XML first: --junitxml, jest-junit, the Playwright junit reporter, Surefire writes it by default; TAP and the Jest, Vitest, pytest-json-report and Playwright JSON reporters are read too).

```diff
No test results matched **/junit*.xml.
```

## V006 Failures in results while the PR claims passing

Not proven yet: reported at low unless the repository opts it in. Default severity: high. Since 0.1.0. Languages: all. Needs: junit, prtext.

The attached results contain failures or errors and the PR text claims the tests pass.

**False positive controls.** Results from a different run than the one the author describes. Attach the XML from the head commit.

```diff
PR body: "all tests pass". junit.xml: 3 failures.
```
