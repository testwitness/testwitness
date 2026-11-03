Adversarial. test.fail() is wrapped in an if on the browser name instead of using the condition argument. The marker is conditional, so it must not be reported as an unconditional expected failure.

Expectation updated 3 Nov: a conditional expected failure is reported low with label conditional, the same way R003 reports a conditional skip.
