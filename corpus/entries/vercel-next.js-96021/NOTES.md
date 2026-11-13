# vercel/next.js#96021

Adds HMR tests for stale route handler and page cached data, two of them as it.failing because the bug is not fixed yet, plus their app fixtures. it.failing tests pass only while the assertion fails, so they are born as expected failures. The engine does not read Jest it.failing as a marker (missed) and reports O006 medium on two fixture source files under the test app (false positives). Stresses R010 on it.failing.
