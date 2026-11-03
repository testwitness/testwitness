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
      - uses: testwitness/testwitness@v1
        with: { junit: "results/**/*.xml" }
```

## What is read

Only the elements every producer agrees on: `testsuite/@name`, `testcase/@name`, `@classname`, `@file`, and the children `skipped`, `failure`, `error`, `flakyFailure`, `flakyError`, `rerunFailure`, `rerunError`. Producer quirks (Surefire reruns, pytest parametrised ids, jest-junit title modes, Playwright project names, Mocha's inverted attributes, pytest reruns as duplicate testcases) are handled by the normaliser and each has a fixture produced by running the real framework.
