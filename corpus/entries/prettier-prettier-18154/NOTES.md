# prettier/prettier#18154

Removes flaky performance checks from the doc printer tests: the 150 ms timing assertion in the test that printDocToString does not manipulate docs, and the whole describe that checked linear time complexity of fill(). Production unchanged. Weakened. Stresses A001 on a removed timing assertion and R001 on a deleted test.each.
