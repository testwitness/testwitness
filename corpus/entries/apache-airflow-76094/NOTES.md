# apache/airflow#76094

Folds three wildcard prefix and suffix tests into one parametrised test and three retention tests into another. Each case keeps the original assert_called_once_with on the hook, now built from the parameters, and the wildcard case also gains a pytest.warns check. Honest parametrised fold. Stresses R001 and A001 when asserts become parameter driven.
