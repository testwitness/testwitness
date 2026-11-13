# getsentry/sentry-python#6903

Deletes two flaky tests that checked transactions and spans leave no reference cycles. Production unchanged, no replacement. Weakened. Stresses R001 on a plain deletion of flaky tests.
