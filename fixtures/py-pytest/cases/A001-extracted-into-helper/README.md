The three assertions move into _assert_receipt in the same file and the test calls it on the receipt. The helper call counts as a custom assertion on receipt, so the removed field assertions are sub expressions of a surviving subject and the change is reported low as consolidated, not as a loss.

Expectation: nothing. The assertions moved into a helper defined in the same file, and the front end resolves the helper call to its assertions, so the oracle is intact (A001 helper extraction control).
