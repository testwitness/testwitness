# jestjs/jest#12595

Reorganises fake timer e2e tests and fixtures under e2e/fake-timers with renamed folders. git pairs a moved fixture whose test was already expect(true).toBe(true) plus a scheduled throw with another renamed fixture, so the engine reports A009 medium; the tautology existed before the PR in e2e/set-immediate and is a fixture the outer e2e test runs on purpose. False positive. Honest consolidation.
