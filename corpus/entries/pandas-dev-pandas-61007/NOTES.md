# pandas-dev/pandas#61007

Restructures test_common: get_callable_name becomes a parametrised test inside a class, the random_state test is split into one test per case in a class, and any_none and all_not_none become parametrised tests. Every original assertion survives as a case. Honest refactor. Stresses R001 and A001 on a test split into several smaller tests.
