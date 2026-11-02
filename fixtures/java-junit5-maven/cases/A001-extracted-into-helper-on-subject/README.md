Negative control. The two assertions move into a private helper assertTotals(cart, total, size) in the same file. The helper call is counted as a custom assertion on cart, and the two removed subjects cart.total() and cart.size() are sub expressions of it, so the rule reports them as consolidated at low.

Expectation: nothing. The assertions moved into a helper defined in the same file, and the front end resolves the helper call to its assertions, so the oracle is intact (A001 helper extraction control).
