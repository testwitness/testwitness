# Producer

- Framework: mocha 11.8.0, Node v22.23.4. mocha 12.x was tried first and fails with mocha-junit-reporter 2.2.1 (`Class constructor Base cannot be invoked without 'new'`), so the fixture pins `mocha@11`.
- Reporter: mocha-junit-reporter 2.2.1

## Commands (run from `project/`)

junit.xml (reporter defaults; pending and skipped tests are NOT emitted as testcase elements):

    npx mocha --reporter mocha-junit-reporter --reporter-options mochaFile=../junit/junit.xml

junit-pending.xml (`includePending=true`, pending and skipped tests appear with `<skipped/>`):

    npx mocha --reporter mocha-junit-reporter --reporter-options mochaFile=../junit/junit-pending.xml,includePending=true

Both runs exit 1 because one test fails on purpose. Console summary equivalent: 5 passing, 3 pending, 1 failing.
