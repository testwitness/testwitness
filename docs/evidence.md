# Evidence: turning on test results

testwitness checks changed tests against what actually ran by reading the test results of the run. JUnit XML is the first recommendation: almost every runner writes it, and it is the format with the most fixtures behind it. One line per framework:

| Framework | What to add | Default output |
|---|---|---|
| Maven Surefire / Failsafe | nothing | `target/surefire-reports/TEST-*.xml` |
| Gradle | nothing | `build/test-results/test/*.xml` |
| pytest | `pytest --junitxml=junit.xml` | `junit.xml` |
| unittest | `python -m pytest --junitxml=junit.xml` or `unittest-xml-reporting` | |
| Jest | `npm i -D jest-junit` and `jest --reporters=default --reporters=jest-junit` | `junit.xml` |
| Vitest | `vitest run --reporter=default --reporter=junit --outputFile=junit.xml` | `junit.xml` |
| Playwright Test | `reporter: [['list'], ['junit', { outputFile: 'junit.xml' }]]` | `junit.xml` |
| Mocha | `npm i -D mocha-junit-reporter` and `mocha --reporter mocha-junit-reporter` | `test-results.xml` |
| TestNG via Surefire | nothing | `target/surefire-reports/TEST-*.xml` |

The `results` input of the Action (`--results` on the CLI, `results.head` in `.testwitness.yml`) takes comma separated globs. It used to be called `junit`, and `junit` still works everywhere; when both are given, `results` wins. The Action's default matches `**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml,**/surefire-reports/*.xml,**/failsafe-reports/*.xml`.

## Other formats

When a runner has no JUnit reporter you want to add, or a job already writes another format, point `results` at that file. Each flag below was run against a fixture project; the versions are in `fixtures/*/results/*/PRODUCER.md`. The format is told from the content, never the file name, so one glob can match a mix:

| Runner | Format | Exact reporter flag | Notes |
|---|---|---|---|
| Node test runner | TAP 13 | `node --test --test-reporter=tap > results.tap` | Node 22 writes no file name, so tests are keyed by their describe chain alone |
| node-tap | TAP 14 | `tap --reporter=tap > results.tap` | the file subtest gives the test file |
| Perl `Test::More`, other TAP producers | TAP without a version line | `perl t/x.t > x.tap` | `Bail out!` is reported in the notes |
| Jest | Jest JSON | `jest --json --outputFile=jest-results.json` | retries from `invocations` |
| Vitest | Vitest JSON | `vitest run --reporter=json --outputFile=vitest-results.json` | retries from the failure messages of a test that passed |
| pytest | pytest-json-report | `pip install pytest-json-report` and `pytest --json-report --json-report-file=report.json` | xfailed reads as skipped, xpassed as passed |
| Playwright Test | Playwright JSON | `PLAYWRIGHT_JSON_OUTPUT_NAME=pw-results.json npx playwright test --reporter=json` | a test run in several projects counts once, worst status |

```yaml
- uses: testwitness/testwitness@v0
  with:
    results: "**/junit*.xml,results.tap,jest-results.json"
```

TAP is read line by line, so its size does not matter; a single line over 1 MB (a minified stack in a YAML block) is skipped with a note. A JSON report has no record boundary and is read whole, so each JSON file must be at most 50 MB, the same cap as coverage and mutation reports; a larger file is refused with a note and the other files are still read. All results files together are read up to 1,000 files and 500 MB; XML and TAP stream, so memory stays flat and the cap bounds the time. Files past either cap are not read, and the report's evidence notes say how many. A file that is none of these formats is skipped with a note, never an error. The report's `evidence.formats` lists the formats that were read.

## Separate test job

```yaml
jobs:
  test:
    steps:
      - run: pytest --junitxml=junit.xml
      - uses: actions/upload-artifact@v4
        with: { name: results, path: junit.xml }
  testwitness:
    needs: test
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { name: results, path: results }
      - uses: testwitness/testwitness@v0
        with: { results: "results/**/*" }
```

## What is read

JUnit XML: only the elements every producer agrees on: `testsuite/@name`, `testcase/@name`, `@classname`, `@file`, and the children `skipped`, `failure`, `error`, `flakyFailure`, `flakyError`, `rerunFailure`, `rerunError`. Producer quirks (Surefire reruns, pytest parametrised ids, jest-junit title modes, Playwright project names, Mocha's inverted attributes, pytest reruns as duplicate testcases) are handled by the normaliser and each has a fixture produced by running the real framework.

TAP: test points (`ok`, `not ok`, the description up to the first unescaped `#`), the `SKIP` and `TODO` directives (both read as skipped, so a failing TODO is not a failure), plans, `# Subtest:` headings, subtests indented four spaces a level, `Bail out!`, and from the YAML blocks only Node's `type: 'test'` or `type: 'suite'`. A Node describe block is not a test; in node-tap and Perl a subtest whose own points are plain assertions is the test and those points are its assertions.

JSON reporters: each test's name path, file and status, mapped so a test gets the same key as from the same runner's JUnit XML: Jest and Vitest `testResults[].assertionResults[]` (`passed`, `failed`, and `pending`, `skipped`, `todo` as skipped), pytest-json-report `tests[].nodeid` and `outcome` (`error` stays an error; `rerun`, which pytest-rerunfailures leaves in place of the final outcome, is decided by the call phase), Playwright `suites[].specs[].tests[]` with the test `status` (`expected`, `unexpected`, `flaky`, `skipped`) and the results of each retry. The quirks of each, with the exact output quoted, are in `fixtures/JUNIT-FIXTURES.md`.

## Coverage reports (optional)

V008 reads line coverage of the head run when you attach it with the `coverage` input of the Action, `--coverage` on the CLI or `coverage.paths` in `.testwitness.yml`. Three formats are read, told apart by their first bytes: lcov (`lcov.info` from Istanbul, c8, Vitest, Jest or `coverage lcov`), Cobertura XML (`coverage.xml` from coverage.py and pytest cov, and the Cobertura writers of other tools) and JaCoCo XML (`jacoco.xml`). Only line hits are read. Paths are made relative to the repository root when the report holds an absolute path under it or a Cobertura source root under it; otherwise they are matched by suffix, so a report written on a CI runner with another checkout path, or a JaCoCo report that names `com/acme/Refund.java`, still finds `src/main/java/com/acme/Refund.java`. The readers stream, stop after 200 report files or 50 MB, never fetch a DTD and never run anything. The report gains a `coverage` section and the comment a Coverage line under Evidence.

```yaml
- uses: testwitness/testwitness@v0
  with:
    results: "**/junit*.xml"
    coverage: "coverage/lcov.info,**/coverage.xml,**/jacoco.xml"
```

## Mutation reports (optional, opt in)

M001 and M002, and the measured grades of O001 and O002, read mutation reports: StrykerJS `mutation.json` (the json reporter) and PIT `mutations.xml` (outputFormats XML), through the `mutation` input, `--mutation` or `mutation.paths`. Producing them means running the tests, which testwitness never does on its own; the separate workflow that does it, triggered by a maintainer's `/testwitness mutate` comment, is described in [mutation on request](./mutation-on-request). mutmut results are not read, because they carry no line numbers or killing tests.

