# PrefectHQ/prefect#20155

Adds Playwright e2e auth test infrastructure: helpers under e2e/fixtures and a smoke test. The engine reports O006 medium on the helper module, which holds no tests by design: a false positive. Honest control.
