# Producer

- Framework: vitest 5.0.5 (built in `junit` reporter), Node v22.23.4, typescript installed as a dev dependency only so the `.ts` sources type check in an editor (vitest strips types itself).

## Command (run from `project/`)

    npx vitest run --reporter=junit --outputFile=../junit/junit.xml

Expected summary: 9 tests, 1 failed, 2 skipped (one `test.skip`, one `test.todo`), 6 passed.
