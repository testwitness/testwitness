# pandas-dev/pandas#67277

Removes the assert_matching helper from MultiIndex get and set tests and inlines tm.assert_* calls on each level. Honest helper inlining.
