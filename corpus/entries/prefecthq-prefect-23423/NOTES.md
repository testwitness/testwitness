# PrefectHQ/prefect#23423

Raises a futures.result timeout from 0.01 to 10 seconds because the error under test comes from the failed future, not from the timeout. Same assertion. Honest flaky fix.
