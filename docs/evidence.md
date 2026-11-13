# Evidence: turning on JUnit XML

testwitness checks changed tests against what actually ran by reading JUnit XML. One line per framework:

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

The default `junit` input matches `**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml,**/surefire-reports/*.xml,**/failsafe-reports/*.xml`.

## Separate test job

```yaml
jobs:
  test:
    steps:
      - run: pytest --junitxml=junit.xml
      - uses: actions/upload-artifact@v4
        with: { name: junit, path: junit.xml }
  testwitness:
    needs: test
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { name: junit, path: results }
      - uses: testwitness/testwitness@v0
        with: { junit: "results/**/*.xml" }
```

## What is read

Only the elements every producer agrees on: `testsuite/@name`, `testcase/@name`, `@classname`, `@file`, and the children `skipped`, `failure`, `error`, `flakyFailure`, `flakyError`, `rerunFailure`, `rerunError`. Producer quirks (Surefire reruns, pytest parametrised ids, jest-junit title modes, Playwright project names, Mocha's inverted attributes, pytest reruns as duplicate testcases) are handled by the normaliser and each has a fixture produced by running the real framework.

## Coverage reports (optional)

V008 reads line coverage of the head run when you attach it with the `coverage` input of the Action, `--coverage` on the CLI or `coverage.paths` in `.testwitness.yml`. Three formats are read, told apart by their first bytes: lcov (`lcov.info` from Istanbul, c8, Vitest, Jest or `coverage lcov`), Cobertura XML (`coverage.xml` from coverage.py and pytest cov, and the Cobertura writers of other tools) and JaCoCo XML (`jacoco.xml`). Only line hits are read. Paths are made relative to the repository root when the report holds an absolute path under it or a Cobertura source root under it; otherwise they are matched by suffix, so a report written on a CI runner with another checkout path, or a JaCoCo report that names `com/acme/Refund.java`, still finds `src/main/java/com/acme/Refund.java`. The readers stream, stop after 200 report files or 50 MB, never fetch a DTD and never run anything. The report gains a `coverage` section and the comment a Coverage line under Evidence.

```yaml
- uses: testwitness/testwitness@v0
  with:
    junit: "**/junit*.xml"
    coverage: "coverage/lcov.info,**/coverage.xml,**/jacoco.xml"
```

## Mutation reports (optional, opt in)

M001 and M002, and the measured grades of O001 and O002, read mutation reports: StrykerJS `mutation.json` (the json reporter) and PIT `mutations.xml` (outputFormats XML), through the `mutation` input, `--mutation` or `mutation.paths`. Producing them means running the tests, which testwitness never does on its own; the separate workflow that does it, triggered by a maintainer's `/testwitness mutate` comment, is described in [mutation on request](./mutation-on-request). mutmut results are not read, because they carry no line numbers or killing tests.

