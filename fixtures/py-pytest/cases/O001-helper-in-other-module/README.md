Negative control. The new test calls check_receipt imported from tests/support.py, which this PR does not touch. The name does not start with assert and no assertions.extra is configured. check_receipt contains a plain assert, and the helper index scans tests/, so the call counts as a custom assertion and O001 is silent.

Expectation changed with the helper index. Before it, helpers in other modules were only recognised through assertions.extra and this case reported O001 low.
