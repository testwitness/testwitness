# pandas-dev/pandas#50749

Moves the checks that groupby operations raise from many tests across the groupby suite into one consolidated test_raises module with parametrised cases. The engine reports A001 medium on eleven tests that lost their pytest.raises blocks; those blocks reappear in test_raises.py. False positives. Honest consolidation.
