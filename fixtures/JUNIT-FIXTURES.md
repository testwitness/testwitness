# Test results fixtures

Every file under `fixtures/<name>/junit/` and `fixtures/<name>/results/<format>/` was produced by running the real framework: the JUnit XML of eight projects in this workspace on 1 Nov 2026 and of java-junit5-maven on the maintainer's Mac on 4 Nov 2026 because Maven Central is blocked from the workspace, and the TAP and JSON reporter output in this workspace on 4 Nov 2026. Nothing was hand written or edited. Each `PRODUCER.md` records versions and the exact command. This page is the input for the readers and the normaliser, so formats are quoted exactly as emitted. The file keeps its old name so links to it still work.

Environment constraint: the workspace proxy denies Maven Central (`repo.maven.apache.org`, `repo1.maven.org`) and the Gradle plugin portal with HTTP 403 on CONNECT. npm and PyPI work. Consequences are noted per fixture.

## Status

| Fixture | Producer | Versions | Files (bytes) | Status |
|---|---|---|---|---|
| java-junit5-maven | Maven surefire | Maven 3.9.x, surefire 3.5.2, JUnit Jupiter 5.11.4, AssertJ 3.26.3, Mockito 5.14.2, openjdk 21 on macOS arm64 | `TEST-demo.CalculatorTest$Division.xml` (9568), `TEST-demo.CalculatorTest.xml` (8739) | OK. Produced on 4 Nov 2026 by the maintainer with `mvn -B test -Dmaven.test.failure.ignore=true`, outside the agent workspace. Surefire wrote the outer class tests into the Division file together with the two nested tests, and the outer file holds only the reruns (flakyPassesOnSecondAttempt passed on retry, failsOnPurpose failed with a rerunFailure). The reader reads flakyPassesOnSecondAttempt as flaky because it failed in one file and passed in the other. |
| java-junit4-gradle | Gradle built in JUnit XML writer | Gradle 8.14.3, JUnit 4.13.2, hamcrest-core 1.3, Java 21 | `TEST-demo.StackTest.xml` (4708), `TEST-demo.StackSizeTest.xml` (582) | OK. Jars taken from `$GRADLE_HOME/lib` via `files(...)` because Central is denied; same artifacts as Central. |
| java-testng-maven | Gradle TestNG runner (fallback) plus TestNG native reporters | Gradle 8.14.3, TestNG 6.3.1, Java 21 | `TEST-demo.PricingTest.xml` (4440, Gradle format), `testng-results.xml` (10568, TestNG native), `testng-junitreports/TEST-demo.PricingTest.xml` (4313, TestNG JUnitReportReporter) | PARTIAL. pom.xml with surefire 3.5.2 and TestNG 7.10.2 is committed but could not run. XML comes from `build.gradle` in the same project using the TestNG 6.3.1 jar bundled with Gradle. No surefire format TestNG XML exists yet. |
| ts-jest | jest-junit | jest 30.5.2, jest-junit 17.0.0 | `junit.xml` (3938), `junit-titles.xml` (3626) | OK |
| ts-vitest | vitest built in `junit` reporter | vitest 5.0.5 | `junit.xml` (1893) | OK |
| ts-playwright | @playwright/test built in `junit` reporter | @playwright/test 1.63.0, Chromium 1243 from `/opt/pw-browsers` | `junit.xml` (3651) | OK. `npx playwright install` is denied by the proxy; 1.63.0 was pinned because its Chromium revision (1243) is pre installed. Real browser used for the `api` project. |
| ts-mocha | mocha-junit-reporter | mocha 11.8.0, mocha-junit-reporter 2.2.1 | `junit.xml` (2040), `junit-pending.xml` (2491) | OK. mocha 12 is incompatible with the reporter (constructor error), pinned to 11. |
| py-pytest | pytest junitxml plugin | pytest 9.1.1, pytest-rerunfailures 16.7, Python 3.13.18 | `junit.xml` (2779), `junit-legacy.xml` (3311), `junit-reruns.xml` (414) | OK |
| py-unittest | pytest junitxml plugin, and unittest-xml-reporting | pytest 9.1.1, unittest-xml-reporting 4.0.0 | `junit.xml` (1428), `xmlrunner/TEST-tests.test_shapes.ShapesTest-20261101133526.xml` (1822), `xmlrunner/TEST-tests.test_shapes.EdgeCasesTest-20261101133526.xml` (401) | OK |
| ts-jest (results/jest-json) | `jest --json` | jest 30.5.2, Node v22.23.4 | `results.json` (6755), `results-retry.json` (3904, a temporary copy with `jest.retryTimes(2)`) | OK |
| ts-vitest (results/vitest-json) | vitest `json` reporter | vitest 5.0.5 | `results.json` (3818), `results-retry.json` (5342, a temporary copy run with `--retry=2`) | OK |
| ts-playwright (results/playwright-json) | @playwright/test `json` reporter | @playwright/test 1.63.0, Chromium 1243 | `results.json` (26831), `results-projects.json` (40623, two projects over `unit.spec.ts`) | OK |
| py-pytest (results/pytest-json-report) | pytest-json-report | pytest-json-report 1.5.0, pytest-metadata 3.1.1, pytest 9.1.1, pytest-rerunfailures 16.7, Python 3.13.18 | `report.json` (9711), `report-reruns.json` (894) | OK. Installed exact from PyPI into a venv with system site packages. |
| ts-node-test (results/tap) | Node test runner `tap` reporter | Node v22.23.4 | `results.tap` (4461) | OK. New project: Node's runner has no JUnit reporter worth recommending over TAP, so it has no `junit/`. |
| ts-node-test (results/tap-node-tap) | node-tap `--reporter=tap` | tap 21.8.1, Node v22.23.4 | `results.tap` (3674) | OK. Source in `source/`, the slugify and clamp tests written for node-tap; reader unit tests only. |
| ts-node-test (results/tap-perl) | Perl Test::More | perl 5.38.2, Test::More 1.302194 | `text.tap` (429), `bail.tap` (81) | OK. Source in `source/t/`; reader unit tests only. |

## Run history cases

The golden cases named `R003-history-*` in java-junit4-gradle, ts-jest and py-pytest carry `history/history.json`, written by the engine through `fixtures/runner/make-history.ts` (the bundled CLI with `--history-out`), never by hand. Most merge the project XML above as several runs. The three flaky cases need a test that passed in some runs and failed in others, which no project XML above has, so their `history/junit/` holds XML from five real runs of a counter based test, with a `PRODUCER.md` each (Gradle 8.14.3 with JUnit 4.13.2, jest 30.5.2 with jest-junit 17.0.0, pytest 9.1.1), produced on 4 Nov 2026. pytest-rerunfailures could not be used for this: it writes the failed first attempt as a plain second testcase element, so `junit-reruns.xml` holds no trace of the rerun.

## Quirks per producer

### Gradle JUnit XML writer (java-junit4-gradle, and the Gradle TestNG file in java-testng-maven)

- Root is `<testsuite>` (no `<testsuites>` wrapper), one file per test class named `TEST-<fqcn>.xml`.
- Suite attributes in order: `name="demo.StackTest" tests="5" skipped="1" failures="1" errors="0" timestamp="2026-11-01T19:36:21.778Z" hostname="vm" time="0.009"`. Timestamp is ISO 8601 UTC with milliseconds and `Z`.
- Always emits `<properties/>`, `<system-out><![CDATA[]]></system-out>` and `<system-err><![CDATA[]]></system-err>` even when empty.
- Testcase: `<testcase name="pushIncreasesSize" classname="demo.StackTest" time="0.001"/>`. `classname` is the fully qualified class. `time` can be `"0.0"`.
- Skip (`@Ignore`): child `<skipped/>` with no attributes, no reason text, even when `@Ignore("not ready")` had a reason.
- Failure: `<failure message="java.lang.AssertionError: expected:&lt;2&gt; but was:&lt;1&gt;" type="java.lang.AssertionError">` with the full stack trace as text content. Assertion failures are `failure`, unexpected exceptions would be `error`.
- `@Test(expected = X.class)` passes look like any other passing testcase.
- JUnit 4 `Parameterized` with `@Parameters(name = "{index}: pushes={0}")`: `name="sizeMatchesPushes[0: pushes=1]"`, so method name then the `name` pattern in square brackets. With the default pattern it would be `[0]`, `[1]`, ...
- TestNG `@DataProvider` through Gradle: `name="appliesRates[0](100.0, 0.0, 100.0)"`, so method name, invocation index in square brackets, then the parameter values in parentheses, comma and space separated, with Java `toString` formatting.
- TestNG `@Test(enabled = false)` is not present at all (not counted, no `<skipped/>`).
- TestNG `@Test(expectedExceptions = ...)` passes look like a plain passing testcase.

### TestNG native `testng-results.xml` (java-testng-maven)

- Root `<testng-results total="6" passed="5" failed="1" skipped="0">`. Children: `<reporter-output>`, then `<suite>` with `<groups>` and `<test>` elements. Under Gradle the names are `name="Gradle suite"` and `name="Gradle test"`; under surefire they would be `Surefire suite` and `Surefire test`.
- Time attributes: `started-at="2026-11-01T13:37:31Z" finished-at="..." duration-ms="42"`. The timestamps here are the local wall clock with a literal `Z` appended (13:37 local, 19:37 UTC), so they are not reliable UTC.
- Each `<class name="demo.PricingTest">` contains `<test-method>` elements: `signature="appliesRates(double, double, double)[pri:0, instance:demo.PricingTest@2abf4075]" name="appliesRates" status="PASS"` (`status` is `PASS`, `FAIL` or `SKIP`). The signature embeds an identity hash, so it differs run to run.
- Data provider invocations are separate `<test-method>` elements with identical `name` and `signature`, distinguished only by a `<params>` block: `<param index="0"><value><![CDATA[100.0]]></value></param>`. Order of methods in the file is not source order (the failing method appeared between two data provider rows).
- Failures: `<exception class="java.lang.AssertionError">` with `<message><![CDATA[...]]></message>` and `<full-stacktrace><![CDATA[...]]></full-stacktrace>`. A passing `expectedExceptions` test also carries an `<exception>` child, so an exception element does not imply failure; use `status`.
- Configuration methods would carry `is-config="true"`; none in this fixture.
- Disabled test absent entirely.

### TestNG `JUnitReportReporter` (java-testng-maven/junit/testng-junitreports)

- Root `<testsuite hostname="vm" failures="0" tests="6" name="demo.PricingTest" time="0.014" errors="1" timestamp="1 Nov 2026 19:37:31 GMT">`. Timestamp is a human readable GMT string, not ISO 8601. Preceded by a comment `<!-- Generated by org.testng.reporters.JUnitReportReporter -->`.
- Assertion failures are reported as `<error message="expected:&lt;999.0&gt; but was:&lt;120.0&gt;" type="java.lang.AssertionError">` with a CDATA stack trace, so `errors="1" failures="0"`. The `message` has the exception class stripped.
- Data provider rows are three separate `<testcase classname="demo.PricingTest" name="appliesRates" .../>` elements with identical names and no parameter information at all.
- Testcases are not in source order.

### jest-junit 17.0.0 (ts-jest)

- Root `<testsuites name="jest tests" tests="8" failures="2" errors="0" time="0.562">`. One `<testsuite>` per test file, named after the top level describe (`name="Billing"`), with `errors`, `failures`, `skipped`, `timestamp="2026-11-01T19:30:04"` (UTC, seconds, no `Z` and no offset), `time`, `tests`.
- Default templates: `classname="{classname} {title}"` and `name="{classname} {title}"`, where `{classname}` is the ancestor titles joined by a single space. So by default `classname` and `name` are identical: `classname="Billing charge charges a valid card" name="Billing charge charges a valid card"`.
- With `JEST_JUNIT_CLASSNAME="{classname}" JEST_JUNIT_TITLE="{title}" JEST_JUNIT_ANCESTOR_SEPARATOR=" › "` (junit-titles.xml): `classname="Billing › charge" name="charges a valid card"`. The separator is applied between ancestors only.
- `it.skip`: child `<skipped/>` with no attributes, `time="0"`.
- `test.todo`: emitted as a plain `<testcase ... time="0">` with NO child element, indistinguishable from a pass at the testcase level. The suite and root `tests` counts exclude it (`tests="8"` while 9 testcase elements are present), and `skipped="1"` counts only the `it.skip`.
- `test.each` rows: the formatted title, for example `name="Billing charge adds 1 and 2 to get 3"`; nothing marks them as parametrised.
- Failure: `<failure>` with no `message` or `type` attribute, the stripped Jest message and stack trace as text content (`Error: expect(received).toBe(expected) // Object.is equality ...`). A snapshot mismatch would be a second `<failure>` of the same shape. Angle brackets in the body are entity escaped (`&lt;anonymous&gt;`).
- Each testcase is written as an open and close pair with a newline inside, never self closing.

### vitest 5.0.5 junit reporter (ts-vitest)

- Root `<testsuites name="vitest tests" tests="9" failures="1" errors="0" time="0.012412902">`, XML declaration ends with ` ?>` (space before `?>`). Times carry nanosecond precision.
- One `<testsuite name="src/cart.test.ts" timestamp="2026-11-01T19:31:25.745Z" hostname="vm" tests="9" failures="1" errors="0" skipped="2" time="...">` per file; the suite name is the file path relative to the project root.
- `classname="src/cart.test.ts"` (the file path) on every testcase; `name` is the full title chain joined with ` > ` and entity escaped: `name="Cart &gt; total &gt; sums line items"`.
- `test.skip` and `test.todo` are both `<skipped/>` with `time="0"`, and both count in `skipped="2"`. No way to tell skip from todo.
- `test.each` titles are formatted: `name="Cart &gt; applyDiscount &gt; applyDiscount(100, 10) -&gt; 90"`.
- Failure: `<failure message="expected 90 to be 80 // Object.is equality" type="AssertionError">` with the diff and a `❯ src/cart.test.ts:35:38` location line as text content.

### @playwright/test 1.63.0 junit reporter (ts-playwright)

- Root `<testsuites id="" name="" tests="9" failures="1" skipped="2" errors="0" time="5.211110000000001">`. No indentation at all.
- One `<testsuite>` per spec file per project. The project name is NOT in the suite name; it is in `hostname`: `<testsuite name="unit.spec.ts" timestamp="2026-11-01T19:33:39.005Z" hostname="unit" tests="7" failures="1" skipped="2" time="0.087" errors="0">`. All suites share the run start timestamp.
- `classname="unit.spec.ts"` (file name relative to `testDir`), `name="pricing › parses a dollar amount"` (describe chain plus title joined with ` › `, U+203A).
- `test.skip` and `test.fixme`: no `time` attribute, a `<properties><property name="skip" value=""></property></properties>` or `<property name="fixme" value="">` block, then `<skipped>` written as an open and close pair with a newline inside (`<skipped>\n</skipped>`), not self closing.
- `test.fail()` that fails as expected: passing testcase with `<properties><property name="fail" value=""></property></properties>` plus a `<system-out>` attachment line.
- Failure after `retries: 1`: a single testcase with one `<failure message="expect(received).toBe(expected) // Object.is equality" type="expect.toBe">` whose CDATA body contains both attempts separated by a `Retry #1 ───` heading. `type` is the matcher name.
- Flaky (failed once, passed on retry): a plain passing testcase with `time` and only a `<system-out>` CDATA block containing `[[ATTACHMENT|../project/test-results/unit-pricing-flaky-passes-on-retry-unit/error-context.md]]`. There is no flaky attribute or element; the attachment line is the only trace.
- Attachment paths are relative to the XML output file.

### mocha-junit-reporter 2.2.1 (ts-mocha)

- Root `<testsuites name="Mocha Tests" time="0.006" tests="8" failures="1" skipped="3">` (no `errors`). First child is always an empty `<testsuite name="Root Suite" ... tests="0">`.
- One `<testsuite>` per describe block, including empty parents (`name="Text" tests="0"`), flattened, not nested. Attributes: `name="slugify" timestamp="2026-11-01T19:32:06" tests="5" file="/abs/path/test/lib.test.js" time="0.004" failures="1"` (`skipped` appears only when includePending is on). Suite names are the describe title alone, no parent chain. Timestamp has no `Z`.
- Testcase attributes are inverted compared with other producers: `name="Text slugify lowercases and joins with dashes"` is the full title chain joined with spaces, and `classname="lowercases and joins with dashes"` is the bare test title.
- Default run (junit.xml): `it.skip`, pending `it('title')` without callback, and tests inside `describe.skip` are NOT emitted as testcase elements. They are only counted in the suite `tests` attribute and the root `skipped="3"`. `tests="5"` with 3 testcase children is therefore normal.
- With `includePending=true` (junit-pending.xml): the same tests appear as `<testcase ... time="0.000">` with child `<skipped/>` and each suite gains `skipped="2"`.
- Failure: `<failure message="Expected values to be strictly equal:\n\n&apos;a-b&apos; !== &apos;a_b&apos;\n" type="AssertionError">` with a CDATA body holding the stack trace and the `+ expected - actual` diff. Message contains raw newlines.
- Time is always three decimals (`time="0.000"`).

### pytest 9.1.1 junitxml (py-pytest and py-unittest/junit/junit.xml)

- Single line output, no whitespace between elements. Root `<testsuites name="pytest tests">` wrapping one `<testsuite name="pytest" errors="1" failures="1" skipped="3" tests="13" time="0.057" timestamp="2026-11-01T13:34:27.906078-06:00" hostname="vm">`. Timestamp is local time with microseconds and a numeric UTC offset.
- `classname` is the dotted module path, plus the class for methods: `classname="tests.test_inventory"` for functions, `classname="tests.test_inventory.TestInventoryClass"` for methods; for unittest `classname="tests.test_shapes.ShapesTest"`.
- Parametrised ids: `name="test_add_parametrized[plain]"`, `name="test_add_parametrized[with space/slash]"`, and non ASCII ids are escaped with Python backslash escapes inside the brackets: `name="test_add_parametrized[\xfcn\xefcode[brackets]]"` (literal backslash x sequences, nested brackets kept).
- `@pytest.mark.skip` and `skipif(True)`: `<skipped type="pytest.skip" message="not implemented yet">/abs/path/tests/test_inventory.py:19: not implemented yet</skipped>`. Both are `type="pytest.skip"`; the condition is not recorded.
- xfail that fails: `<skipped type="pytest.xfail" message="known bug: ..." />`, self closing. An `@unittest.expectedFailure` through pytest also gives `<skipped type="pytest.xfail" message="" />`. These count in `skipped`.
- xpass (non strict): a plain passing testcase, indistinguishable from a pass.
- Failure: `<failure message="AssertionError: assert 2 == 5&#10; +  where 2 = count('sku-1')&#10; ...">` with the assertion rewrite explanation as text; newlines in `message` are `&#10;`. Angle brackets entity escaped.
- Fixture error: `<error message="failed on setup with &quot;RuntimeError: fixture setup exploded&quot;">` and `errors="1"`.
- unittest `subTest`: nothing in the XML; `test_rect_perimeter_subtests` is one passing testcase although the console reported `3 subtests passed`.
- `junit_family=legacy` (junit-legacy.xml) is identical except every testcase gains `file="tests/test_inventory.py" line="5"` (path relative to rootdir, 0 based line of the `def`; parametrised rows all share the definition line).
- pytest-rerunfailures (junit-reruns.xml): there is NO `<rerun>` or `<flakyFailure>` element. The rerun attempt appears as an extra `<testcase classname="tests.test_rerun" name="test_flaky_passes_on_rerun" time="0.002" />` with no children, followed by the final passing attempt with the same name. `tests="1"` counts only the final attempt, so duplicate names with no children are the rerun signal.

### unittest-xml-reporting 4.0.0 (py-unittest/junit/xmlrunner)

- One file per TestCase class with a timestamp in the file name: `TEST-tests.test_shapes.ShapesTest-20261101133526.xml`. Root is `<testsuite>` (no `<testsuites>`), tab indented.
- Suite: `<testsuite name="tests.test_shapes.ShapesTest-20261101133526" tests="6" file="tests/test_shapes.py" time="0.002" timestamp="2026-11-01T13:35:26" failures="1" errors="0" skipped="2">`. The suite `name` includes the run timestamp suffix. Timestamp is local time without offset.
- Testcase: `<testcase classname="tests.test_shapes.ShapesTest" name="test_circle_area" time="0.000" timestamp="2026-11-01T13:35:26" file="tests/test_shapes.py" line="8"/>` (per test `timestamp`, `file`, `line`; line is 1 based decorator or def line).
- `@unittest.skip`: `<skipped type="skip" message="not implemented yet"/>`.
- `@expectedFailure`: `<skipped type="XFAIL" message="expected failure: (&lt;class 'AssertionError'&gt;, AssertionError('4 != 5'), &lt;traceback object at 0x...&gt;)"/>`, counted in `skipped`. Message embeds a repr with a memory address, so it changes every run.
- Failure: `<failure type="AssertionError" message="8 != 9">` with a CDATA traceback. `message` has the exception class stripped; `type` carries it.
- `subTest`: single passing testcase, no detail.

### Jest 30.5.2 `--json` (ts-jest/results/jest-json)

- One compact line. Top level keys: `numFailedTestSuites`, `numFailedTests`, `numPassedTestSuites`, `numPassedTests`, `numPendingTestSuites`, `numPendingTests`, `numRuntimeErrorTestSuites`, `numTodoTests`, `numTotalTestSuites`, `numTotalTests`, `openHandles`, `snapshot`, `startTime`, `success`, `testResults`, `wasInterrupted`. `numTotalTests: 9` counts the todo.
- One `testResults[]` entry per file with `name` set to the absolute path (`/home/claude/testwitness/fixtures/ts-jest/project/src/billing.test.js`), `status: "failed"`, `message` holding the formatted failure (`  ● Billing › charge › fails on purpose ...`), `assertionResults`.
- Each assertion result: `"ancestorTitles":["Billing","charge"]`, `"title":"charges a valid card"`, `"fullName":"Billing charge charges a valid card"` (ancestors and title joined by one space), `"status":"passed"`, `"invocations":1`, `"location":null` (no `testLocationInResults`), `numPassingAsserts`, `retryReasons`, `retryMessages`, `failureDetails`, `failureMessages`, `duration`, `startAt`.
- `it.skip` is `"status":"pending"` and `test.todo` is `"status":"todo"`, both with `"duration":null`. `test.each` rows have the formatted title (`"adds 1 and 2 to get 3"`).
- Failure: `"status":"failed"` with `failureMessages` holding `Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 99\nReceived: 10\n    at Object.toBe (/abs/path/src/billing.test.js:30:69)`; no ANSI codes.
- Retries (`jest.retryTimes(2)`): the test that passed on its second attempt is `"status":"passed","invocations":2` with empty `failureMessages` and empty `retryReasons`; the one that always failed is `"status":"failed","invocations":3` with one failure message. `retryReasons` stays empty unless `logErrorsBeforeRetry` is set, so `invocations` is the only trace of a retry.

### Vitest 5.0.5 `json` reporter (ts-vitest/results/vitest-json)

- The Jest shape with differences. No `openHandles`, `wasInterrupted` or `numRuntimeErrorTestSuites` at the top; that is how the reader tells the two apart. `numTotalTestSuites: 4` and `numFailedTestSuites: 3` count the describe blocks as suites as well as the file.
- `testResults[]`: `assertionResults`, `startTime`, `endTime`, `status`, `message` (`""` even when a test failed), `name` (absolute path).
- Each assertion result: `ancestorTitles`, `fullName` (joined by one space, `"Cart applyDiscount applyDiscount(100, 10) -> 90"`), `status`, `title`, `duration` (fractional milliseconds, absent for skipped and todo), `failureMessages`, `meta: {}`, `tags: []`, `benchmarks: []`. No `invocations`, no `location`.
- `test.skip` is `"status":"skipped"` and `test.todo` is `"status":"todo"`; unlike the junit reporter, the two are told apart.
- Failure message: `AssertionError: expected 90 to be 80 // Object.is equality\n    at /abs/path/src/cart.test.ts:35:38`.
- Retries (`--retry=2`): no field counts attempts. The test that passed on its second attempt is `"status":"passed"` with ONE entry in `failureMessages` (the failed first attempt); the test that always failed has three.

### pytest-json-report 1.5.0 (py-pytest/results/pytest-json-report)

- Top level keys: `created`, `duration`, `exitcode`, `root` (absolute project path), `environment` (`{}` here although pytest-metadata 3.1.1 is installed), `summary`, `collectors`, `tests`. The file is JSON with the plugin's own line breaks (`"collectors": [\n{`), not the output of a standard indent setting.
- `summary`: `{"passed": 7, "skipped": 2, "xfailed": 1, "xpassed": 1, "failed": 1, "error": 1, "total": 13, "collected": 13}`.
- `tests[]`: `nodeid`, `lineno` (0 based line of the `def`, as junitxml legacy), `outcome`, `keywords`, and `setup`, `call`, `teardown` phases each with `duration` and `outcome`. A phase that did not run is absent.
- Node ids: `tests/test_inventory.py::test_add_increases_count`, `tests/test_inventory.py::TestInventoryClass::test_rejects_non_positive`, parametrised ids with the same backslash escapes as junitxml: `tests/test_inventory.py::test_add_parametrized[\\xfcn\\xefcode[brackets]]` (JSON escaped).
- Outcomes: `skipped` has only `setup` (outcome skipped) and `teardown`; `xfailed` has `call.outcome: "skipped"` with a `crash` and a `traceback`; `xpassed` has `call.outcome: "passed"`; `error` (fixture setup raised) has `setup.outcome: "failed"` and no `call`.
- pytest-rerunfailures: the test that failed once and passed on the rerun is a single record with `"outcome": "rerun"` and `call.outcome: "passed"`, and the summary is `{"rerun": 1, "total": 1, "collected": 1}` with no `passed` key. The final pass is only visible in the call phase; the number of attempts is not recorded.

### @playwright/test 1.63.0 `json` reporter (ts-playwright/results/playwright-json)

- Indented two spaces. Top level keys: `config`, `suites`, `errors`, `stats`; `stats` is `{"startTime": "2026-11-04T17:03:01.935Z", "duration": 3725.8999999999996, "expected": 5, "skipped": 2, "unexpected": 1, "flaky": 1}`.
- `suites[]` is one suite per spec file: `{"title": "unit.spec.ts", "file": "unit.spec.ts", "column": 0, "line": 0, "specs": [...], "suites": [...]}`, the file relative to `testDir`. Describe blocks are nested `suites` with their own `line` and `column`. A test outside any describe sits in the file suite's `specs`, listed before the nested suites.
- Spec: `title`, `ok`, `tags`, `tests`, `id`, `file`, `line`, `column`. Test: `timeout`, `annotations`, `expectedStatus`, `projectId`, `projectName`, `results`, `status`.
- Test `status` is `expected`, `unexpected`, `flaky` or `skipped`. `test.fail()` that fails: `"expectedStatus": "failed"`, `"status": "expected"`, one result with `"status": "failed"`. `test.skip` and `test.fixme`: `"status": "skipped"` with an annotation `{"type": "skip"}` or `{"type": "fixme"}` carrying the source location.
- Results, one per attempt with `retry` 0, 1: the failing test (`retries: 1`) has `failed, failed` and status `unexpected`; the flaky test has `failed, passed` and status `flaky`. Error messages hold ANSI colour codes as `\u001b[2m` escapes.
- Two projects over the same spec file (results-projects.json): still one file suite, whose `specs` repeat once per project, each holding one test with its `projectName`. The flaky test is `flaky` in `first` and `expected` in `second` because the counter file is shared.

### Node v22.23.4 test runner, `tap` reporter (ts-node-test/results/tap)

- `TAP version 13`. Every test AND every describe block is a test point preceded by `# Subtest: <name>` at the point's own indentation; children are indented four spaces and end with their own plan (`        1..5`) before the parent point.
- Each point is followed by a YAML block indented two more spaces: `duration_ms: 0.900661` and `type: 'test'` or `type: 'suite'`. A failure adds `location: '/abs/path/test/text.test.js:21:5'`, `failureType: 'testCodeFailure'`, `error`, `code: 'ERR_ASSERTION'`, `name`, `expected`, `actual`, `operator`, `stack`. A describe block over a failure is `not ok 1 - slugify` with `failureType: 'subtestsFailed'` and `error: '1 subtest failed'`.
- `location` is written for failures only, so passing tests carry no file at all.
- No subtest per file: the points of both files share one top level sequence numbered 1 to 6 (`extras.test.js` first), and `1..6` comes last, followed by `# tests 13`, `# suites 3`, `# pass 8`, `# fail 1`, `# cancelled 0`, `# skipped 2`, `# todo 2`, `# duration_ms ...`.
- `it.skip`: `ok 3 - handles unicode # SKIP`; `{ skip: 'reason' }`: `ok 2 - skipped with a reason # SKIP waiting on the upstream fix`; `it.todo` without a body: `ok 4 - keeps numbers # TODO`; a todo whose body fails: `not ok 3 - todo that fails # TODO not finished` with the failure YAML.
- A test with `t.test` subtests (`clamp table`) is `type: 'test'` with its subtests as points of `type: 'test'` below it.

### node-tap 21.8.1 `--reporter=tap` (ts-node-test/results/tap-node-tap)

- `TAP version 14`, then the plan `1..1` first, then `# Subtest: test/text.test.js`: the whole file is one subtest named by its path relative to the project, at column 0, its body indented four spaces.
- Each `t.test` is a subtest whose points are the assertions: `ok 1 - should be equal` and its own `1..1`, then the parent point `ok 1 - lowercases and joins with dashes # time=5.725ms`. The ` # time=` comment is not a directive. Blank lines (indented) follow each subtest.
- Skip and todo subtests have no body: `ok 2 - handles unicode # SKIP not supported yet`, `ok 3 - keeps numbers # TODO`.
- Failure YAML: `compare: ===`, `at:` with `fileName: test/text.test.js` (relative), `lineNumber`, `columnNumber`, `typeName`, `stack`, `source` (with a `--------^` marker), `diff`. The file point's YAML holds `command`, `args`, `cwd`, `exitCode: 1`.
- Ends with `# No coverage generated`, `# { total: 5, pass: 2, fail: 1, todo: 1, skip: 1 }`, `# time=1124.751ms`.

### Perl Test::More 1.302194 (ts-node-test/results/tap-perl)

- No `TAP version` line; the plan `1..6` comes first.
- `skip` writes no description: `ok 3 # skip unicode is not handled yet` (lower case directive).
- A failing TODO: `not ok 4 - keeps numbers # TODO numbers are not kept yet`, then `#   Failed (TODO) test 'keeps numbers'` and the got and expected lines as comments on stdout.
- `subtest`: `# Subtest: clamp table` at column 0, then the child plan first (`    1..2`), the child points, then `ok 6 - clamp table`.
- `BAIL_OUT`: `Bail out!  fixture database is gone` (two spaces after the `!`), nothing after it; the plan said `1..3` and one point was written.

## Cross producer summary for the normaliser

| Concept | Gradle | TestNG native | jest-junit | vitest | playwright | mocha-junit-reporter | pytest | xmlrunner |
|---|---|---|---|---|---|---|---|---|
| Root | `testsuite` | `testng-results` | `testsuites` | `testsuites` | `testsuites` | `testsuites` | `testsuites` | `testsuite` |
| Class or container field | `classname` fqcn | `class@name` | `classname` = ancestors joined by space (default) | `classname` = file path | `classname` = file name, project in suite `hostname` | `classname` = bare title (inverted) | `classname` = dotted module[.Class] | `classname` = dotted module.Class |
| Test name field | method `[params]` | `test-method@name` + `params` | full chain (default) or title | `A > B > title` | `describe › title` | full chain joined by space | `test_x[id]` | method |
| Skip | `<skipped/>` | `status="SKIP"` | `<skipped/>` | `<skipped/>` | `<properties><property name="skip"/>` + `<skipped>` | omitted unless includePending, then `<skipped/>` | `<skipped type="pytest.skip" message>` | `<skipped type="skip" message>` |
| Todo or fixme | n/a | n/a | bare testcase, uncounted | `<skipped/>` | `property name="fixme"` + `<skipped>` | omitted (pending) | n/a | n/a |
| xfail | n/a | n/a | n/a | n/a | `property name="fail"`, passing | n/a | `<skipped type="pytest.xfail">` | `<skipped type="XFAIL">` |
| Failure | `<failure message type>` | `status="FAIL"` + `<exception>` | `<failure>` no attrs | `<failure message type>` | `<failure message type=matcher>` | `<failure message type>` | `<failure message>` | `<failure type message>` |
| Error | `<error>` | n/a | `<error>` | `<error>` | n/a | n/a | `<error message>` | `<error>` |
| Flaky or rerun | surefire `flakyFailure` (not captured) | n/a | n/a | n/a | passing testcase with attachment in `system-out` only | n/a | duplicate bare testcase before the final one | n/a |
| Disabled (TestNG) | absent | absent | | | | | | |
| Timestamp | ISO UTC `Z` ms | local time with fake `Z` | ISO UTC no `Z` | ISO UTC `Z` ms | ISO UTC `Z` ms | ISO no `Z` | local with offset and microseconds | local no offset |

## Keys from the other formats

| Format | Class side of the key | Name side | Same keys as |
|---|---|---|---|
| Jest JSON | stem of `testResults[].name` | `ancestorTitles` and `title` joined by ` › ` | the Vitest junit shape (inventory key `stem::chain`) |
| Vitest JSON | stem of `testResults[].name` | `ancestorTitles` and `title` joined by ` › ` | Vitest junit, checked file for file in the unit tests |
| pytest-json-report | node id file as a dotted module, plus classes | last node id part with its `[param]` | pytest junitxml, checked in the unit tests |
| Playwright JSON | stem of the spec file | describe titles and spec title joined by ` › ` | Playwright junit, checked in the unit tests |
| TAP with a file subtest (node-tap) | stem of the file subtest | the chain below it | Vitest and Playwright junit shape |
| TAP without one (Node 22, Perl) | the chain | the chain | jest-junit default shape |
