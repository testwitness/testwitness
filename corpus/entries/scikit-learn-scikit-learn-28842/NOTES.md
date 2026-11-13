# scikit-learn/scikit-learn#28842

Moves tests of utils helpers into the test file of each helper module and drops test_deprecated from test_utils.py, which duplicated test_deprecated in the unchanged test_deprecation.py. The engine reports R001 medium on it because it cannot see the unchanged duplicate. Honest cleanup.
