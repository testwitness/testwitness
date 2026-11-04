# Rules reference

Generated from the rule definitions in `packages/core/src/rules`. Do not edit by hand; run `pnpm gen:docs`.

## R001 Test function deleted

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A test present in the base is absent in the head and no test with the same body exists elsewhere in the head tree.

**False positive controls.** Renamed tests with the same body are not reported. Reported low with a label when the test was moved to another file (same body, or same name added elsewhere in the PR), folded into a parameterised test whose case count covers the removed tests, rewritten (other changed test files gained at least as many tests as the PR deleted), replaced (its class or group gained as many new tests as it lost) or refactored (every assertion survives in a changed file). Precision over recall: a deletion is medium or high only when none of those signals is present.

```diff
-  @Test
-  void rejectsNegativeAmount() {
-    assertThrows(IllegalArgumentException.class, () -> svc.charge(-1));
-  }
```

## R002 Test file deleted

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A file matching test patterns was deleted. The number of tests lost is counted from the base inventory.

**False positive controls.** A file whose tests all reappear elsewhere in the head tree (same bodies) is reported low as moved. Git rename detection handles pure moves before this rule runs.

```diff
deleted file mode 100644 src/__tests__/billing.test.ts
```

## R003 Test newly skipped or disabled

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A skip, todo or fixme marker was added to a test that ran in the base.

**False positive controls.** Conditional skips whose condition is not a constant (platform or optional dependency checks) are reported low. A reason that references an issue number or tracker URL lowers the severity one step.

```diff
+  @pytest.mark.skip(reason="flaky in CI")
   def test_batches(n):
```

## R004 Test converted to expected failure

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

An xfail, expectedFailure, test.fails or test.fail marker was added to a test that was expected to pass in the base.

**False positive controls.** A strict xfail with a reason that references an issue is lowered to medium: the failure is documented and will fail the suite once fixed.

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

**False positive controls.** None by design: this is informational. It rises to medium when the PR text claims the test as coverage.

```diff
+  test.fixme('handles 3DS challenge', async ({ page }) => {
```

## A001 Assertion removed

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A modified test lost one or more assertions and gained no replacement on the same subject.

**False positive controls.** Consolidation of several assertions into one on the same subject (toEqual on an object, assertAll) is reported low as consolidated. A reduction matched by an increase in another test of the same class or describe block is reported low as assertions moved. Assertions moved into a helper in the same file are still counted. When the test gained at least as many new call statements as it lost assertions (a callee name not called anywhere in the base body, not a print, log or sleep call), the assertions were probably replaced by a helper defined elsewhere, such as result.did_create(path): the finding drops one step (medium to low, high to medium) and is labelled replaced by call with the first new callee in the message.

```diff
   expect(res.status).toBe(200);
-  expect(res.body.total).toBe(1250);
-  expect(ledger.entries).toHaveLength(2);
```

## A002 Assertion loosened

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

An assertion on a subject was replaced by a weaker one. Every assertion is read onto one lattice shared by all languages: exact equality and snapshots at the top, then ordered or near equality (startsWith, an anchored regex, containsExactlyInAnyOrder, closeTo), then containment (toContain, contains, in, toMatchObject, hasItem, an unanchored regex), then a bound (greaterThan, >=, toBeLessThan), then a non empty check (greater than zero, not equal to zero, isNotEmpty), and at the bottom existence or truthiness (assertNotNull, toBeDefined, is not None, assertTrue on a plain value). Mock, exception and other library specific checks keep the strength their front end gives them. Base and head assertions are paired by subject: the same text first, then the same subject once identity accessors (length, size(), len(), trim(), get()), copies with a few fields overridden and boolean wrappers are removed, so assertTrue(body.contains(x)) is a containment check on body and all(d.get(k) == v for k, v in e.items()) is a subset check on d. A local name bound once to a projection of another reference is followed to that reference.

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

A test added in this PR has no assertion: no framework assertion, no exception expectation, no snapshot, and no call to an assertion helper defined in the file or configured in assertions.extra.

**False positive controls.** Smoke tests named contextLoads, smoke or DoesNotThrow are reported low with the label smoke. Helpers whose body contains an assertion are counted as assertions one level deep. Tests delegating to helpers in another module need assertions.extra. Assertions inside nested scopes of the test body (callbacks, lambdas, anonymous and local classes, inner functions) are counted. The default is low (informational) until mutation on request exists: on public PRs half of the new tests without an assertion were intentional smoke tests (race tests, verbose output tests, does not throw tests), so a static rule cannot carry medium or high here. Raise it per repository with rules: { O001: medium } in .testwitness.yml.

```diff
+  @Test
+  void processesBatch() {
+    service.process(batch);
+  }
```

## O002 New test with a smoke oracle only

Default severity: low. Since 0.1.0. Languages: all. Needs: diff, ast.

A new test whose only assertions are existence or type checks (toBeDefined, assertNotNull, isNotNone, not.toThrow, assertDoesNotThrow) or a bare snapshot. It proves the code ran, not what it did.

**False positive controls.** A test that is meant as a smoke test. Reported low by default; medium when the PR text calls it a regression test.

```diff
+  it('computes the discount', () => {
+    expect(computeDiscount(cart)).toBeDefined();
+  });
```

## O006 New test file with no tests collected

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast.

A new file matching test patterns defines no collectable test (wrong name prefix, missing @Test, describe without it). It reads as coverage and runs nothing.

**False positive controls.** Shared test helpers and fixtures placed in a tests directory. Add them to paths.ignore or name them so they do not match test patterns.

```diff
+// tests/helpers.test.ts
+export function makeUser() { ... }
```

## E001 Catch all added in a test

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast.

A try block now wraps part of the test and its catch (Exception, Throwable, bare except, any JavaScript catch, or .catch(() => {})) neither rethrows, fails nor asserts. A failing subject call no longer fails the test.

**False positive controls.** Cleanup wrappers with finally only are not catches. Catch blocks that assert on the exception, call fail(), or rethrow are not reported. A catch that existed in the base is not reported.

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

## V003 Changed test did not run

Default severity: high. Since 0.1.0. Languages: all. Needs: diff, ast, junit.

A test added or modified by the PR has no record in the JUnit XML of this run. Names are normalised across Surefire, Gradle, pytest, jest-junit, Vitest, Playwright and Mocha producers.

**False positive controls.** Tests in a matrix leg whose XML was not uploaded; parametrised or dynamic names the normaliser missed. When no test from the same file ran the finding is medium with the label file not in results. When fewer than half of the changed test files appear in the results at all, every finding in this group is low with the label partial results.

```diff
Modified test CartTest#handlesEmpty has no testcase record in 3 result files (42 tests).
```

## V004 Claim in PR text not supported by results

Default severity: medium. Since 0.1.0. Languages: all. Needs: diff, ast, prtext.

The PR title or body claims that tests pass, that tests were added, or that nothing changed in tests, and the diff or the attached results do not support it. Claims that cannot be checked are reported as unreadable (low), never as false.

**False positive controls.** Claims quoted from a template or inside code blocks (stripped), negated claims (skipped). Wording is always "not supported by the results attached to this run".

```diff
PR body says "all tests pass"; results show 2 failures.
```

## V005 No test results found

Default severity: low. Since 0.1.0. Languages: all. Needs: diff.

The PR touches tests or test configuration and no JUnit XML was found. The evidence section reads unreadable and changed tests cannot be checked against what ran.

**False positive controls.** None: this is an instruction to add a reporter (--junitxml, jest-junit, the Playwright junit reporter, Surefire writes it by default).

```diff
No JUnit XML matched **/junit*.xml.
```

## V006 Failures in results while the PR claims passing

Default severity: high. Since 0.1.0. Languages: all. Needs: junit, prtext.

The attached results contain failures or errors and the PR text claims the tests pass.

**False positive controls.** Results from a different run than the one the author describes. Attach the XML from the head commit.

```diff
PR body: "all tests pass". junit.xml: 3 failures.
```
