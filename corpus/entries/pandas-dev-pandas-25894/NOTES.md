# pandas-dev/pandas#25894

Splits the flaky half of test_time into a new test_time_change_xlim marked slow and xfail(strict=False) with reason 'Unreliable test'. A non strict xfail means the assertions no longer gate anything. Weakened. Stresses the xfail rule and strictness detection.
