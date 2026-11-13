# Producer

- Framework: jest 30.5.2 (jest-circus runner, the version in `project/package-lock.json`), Node v22.23.4, built in `--json` output. Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after Jest wrote the files; they keep the absolute paths of the workspace.
- jest-junit stays configured in `project/jest.config.js`; its XML was sent to a temporary directory so `../../junit/junit.xml` is untouched.

## results.json (run from `project/`)

    JEST_JUNIT_OUTPUT_DIR=/tmp/jj npx jest --ci --json --outputFile=../results/jest-json/results.json

Console summary: `Tests: 1 failed, 1 skipped, 1 todo, 6 passed, 9 total`.

## results-retry.json

`retry-src/retry.test.js` (here) copied into a temporary copy of `project/` (package.json and jest.config.js copied, node_modules linked). It calls `jest.retryTimes(2)`; one test fails on its first attempt and passes on the second (a counter file), the other always fails.

    rm -f src/.retry-counter
    JEST_JUNIT_OUTPUT_DIR=/tmp/jj npx jest --ci --json --outputFile=<this directory>/results-retry.json

Console summary: `Tests: 1 failed, 1 passed, 2 total`. The JSON says `invocations: 2` for the flaky test and `invocations: 3` for the failing one; `retryReasons` is empty in both.
