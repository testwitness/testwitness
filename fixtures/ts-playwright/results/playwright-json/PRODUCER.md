# Producer

- Framework: @playwright/test 1.63.0 (the version in `project/package-lock.json`), Node v22.23.4, built in `json` reporter, Chromium 1243 from `/opt/pw-browsers` as in `../../junit/PRODUCER.md`. Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after Playwright wrote the files; they keep the absolute paths of the workspace.
- `--reporter=json` on the command line replaces the reporters of `project/playwright.config.ts`, so the junit file is untouched.

## results.json (run from `project/`)

    rm -f .flaky-counter
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PLAYWRIGHT_JSON_OUTPUT_NAME=../results/playwright-json/results.json \
      npx playwright test --reporter=json

Stats in the file: `expected: 5, skipped: 2, unexpected: 1, flaky: 1`. Exit code 1.

## results-projects.json

The same `tests/` in a temporary copy of `project/` (node_modules linked) with `projects-src/playwright.config.ts` (here): two projects, `first` and `second`, both running `unit.spec.ts`, `retries: 1`.

    rm -f .flaky-counter
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PLAYWRIGHT_JSON_OUTPUT_NAME=<this directory>/results-projects.json \
      npx playwright test --reporter=json

Stats: `expected: 7, skipped: 4, unexpected: 2, flaky: 1`. The flaky test is flaky in `first` and passes on its first attempt in `second`, because the counter file is shared.
