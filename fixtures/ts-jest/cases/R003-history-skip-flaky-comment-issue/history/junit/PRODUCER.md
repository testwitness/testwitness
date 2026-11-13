# Producer

- Framework: jest 30.5.2 with jest-junit 17.0.0 on Node v22.23.4, the setup of `fixtures/ts-jest/junit/PRODUCER.md` (jest-junit default templates).
- Test: `base/src/retry.test.js` of this case, copied into a temporary copy of `fixtures/ts-jest/project` (node_modules linked). It counts its own runs in `src/.retry-counter` and fails on every fourth run, so five runs give pass, pass, pass, fail, pass.
- Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after jest-junit wrote it; the stack trace in run 4 keeps the temporary paths.

## Command (run from the temporary project copy, five times)

    rm -f src/.retry-counter
    for i in 1 2 3 4 5; do
      JEST_JUNIT_OUTPUT_DIR=<this directory> JEST_JUNIT_OUTPUT_NAME=junit-run-$i.xml npx jest --ci src/retry.test.js
    done

Console summaries: `Tests: 1 passed, 1 total` for runs 1, 2, 3 and 5, `Tests: 1 failed, 1 total` for run 4.
