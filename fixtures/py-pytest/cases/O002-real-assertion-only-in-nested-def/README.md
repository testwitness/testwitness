The exact equality lives in a nested function that is never called; the test itself only asserts is not None. Nested assertions do not count, so this is still a smoke only test and is reported low.
