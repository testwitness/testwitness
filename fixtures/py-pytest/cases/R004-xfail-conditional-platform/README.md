The xfail has a non constant platform condition. On every other platform the test is still expected to pass, so it is not an expected failure and R004 does not fire.

Expectation updated 3 Nov: a conditional xfail is reported low with label conditional, the same way R003 reports a conditional skip.
