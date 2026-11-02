# Producer

- Framework: @playwright/test 1.63.0 (built in `junit` reporter), Node v22.23.4.
- Browser: Chromium build 1243 (the revision 1.63.0 expects), used from the pre installed `/opt/pw-browsers` via `PLAYWRIGHT_BROWSERS_PATH`. `npx playwright install chromium` was tried and fails because the proxy denies `cdn.playwright.dev` and `playwright.azureedge.net`; the latest @playwright/test (1.64.1) wants Chromium 1248 which is not present, so the fixture pins `~1.63`. The `api` project runs two real browser tests with `page`; the `unit` project uses no browser.
- Config: `project/playwright.config.ts` with `retries: 1`, `workers: 1`, projects `unit` and `api`, reporter `[['list'], ['junit', { outputFile: '../junit/junit.xml' }]]`.
- Flaky test uses a file counter at `project/.flaky-counter` (gitignored); delete it before each run.

## Command (run from `project/`)

    rm -f .flaky-counter && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test

Console summary: 1 failed, 1 flaky, 2 skipped, 5 passed. Exit code 1.
