# testwitness

Did this PR weaken its tests, and did they actually run?

testwitness reads a pull request's diff, the test code and the test results (JUnit XML, TAP or a JSON reporter) from the test run and tells the reviewer whether the tests still mean anything. Java, TypeScript, JavaScript and Python. No model, no secrets, no network, never runs your code.

## Quick start

```yaml
# .github/workflows/testwitness.yml
name: testwitness
on:
  pull_request:
permissions:
  contents: read
jobs:
  testwitness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: testwitness/testwitness@v0
        with:
          results: "**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml"
```

If your tests run in a separate job, upload their results as an artifact, download them in this job, and point `results` at them. See [Evidence](./evidence) for the one line per framework that turns the reporter on.

Locally:

```bash
npx testwitness check --base origin/main --head HEAD --results "**/junit*.xml"
```

## What you get

One PR comment updated in place, annotations on the Files tab, a job summary, and `testwitness.json` for anything you want to build on top. Three states: `pass`, `review`, `unreadable`. See [How it decides](./how-it-decides).

## Privacy

Nothing leaves the runner. The report contains file paths, test names and snippets of changed test lines; it is written to the workspace and nowhere else.
