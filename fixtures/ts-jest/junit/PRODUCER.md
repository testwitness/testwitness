# Producer

- Framework: jest 30.5.2 (jest-circus runner), Node v22.23.4
- Reporter: jest-junit 17.0.0, configured in `project/jest.config.js` as `reporters: ['default', 'jest-junit']`
- Snapshot: written once with a plain `npx jest` run (no `--ci`), committed at `project/src/__snapshots__/billing.test.js.snap`, then both XML runs used `--ci` so the snapshot test passes against the committed file.

## Commands (run from `project/`)

junit.xml (jest-junit defaults):

    JEST_JUNIT_OUTPUT_DIR=../junit JEST_JUNIT_OUTPUT_NAME=junit.xml npx jest --ci

junit-titles.xml (classname and title placeholders, ancestor separator):

    JEST_JUNIT_OUTPUT_DIR=../junit JEST_JUNIT_OUTPUT_NAME=junit-titles.xml \
    JEST_JUNIT_CLASSNAME="{classname}" JEST_JUNIT_TITLE="{title}" \
    JEST_JUNIT_ANCESTOR_SEPARATOR=" › " npx jest --ci

Expected console summary for both: `Tests: 1 failed, 1 skipped, 1 todo, 6 passed, 9 total`.
