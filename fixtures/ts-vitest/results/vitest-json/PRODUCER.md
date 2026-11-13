# Producer

- Framework: vitest 5.0.5 (the version in `project/package-lock.json`), Node v22.23.4, built in `json` reporter. Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after Vitest wrote the files; they keep the absolute paths of the workspace.

## results.json (run from `project/`)

    npx vitest run --reporter=json --outputFile=../results/vitest-json/results.json

Summary: 9 tests, 1 failed, 1 skipped, 1 todo, 6 passed.

## results-retry.json

`retry-src/retry.test.ts` (here) copied into a temporary copy of `project/` (package.json copied, node_modules linked). One test fails on its first attempt and passes on the second (a counter file), the other always fails.

    rm -f src/.retry-counter
    npx vitest run --retry=2 --reporter=json --outputFile=<this directory>/results-retry.json

The JSON has no `invocations` field: the flaky test is `status: "passed"` with one entry in `failureMessages`, the failing one has three.
