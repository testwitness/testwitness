# vercel/next.js#52007

In the checkMeta helper used by the metadata e2e tests, replaces expect(values[0]).toBe(expected) with a check that the expected value is somewhere among the matched tags. Weakened: order and duplicates are no longer checked, for every test that calls the helper. Stresses A002 on exact to contains inside a shared helper, where the subject changes from an element to a boolean.
