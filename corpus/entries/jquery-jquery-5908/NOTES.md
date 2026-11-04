# jquery/jquery#5908

Replaces assert.strictEqual on the reported error line ("1") and column ("11") with assert.ok on a regex match that accepts any single digit line and any two digit column. Weakened: the exact position is no longer checked. Stresses A002 on strict equality to truthiness in a QUnit test, a framework the TypeScript front end does not parse today.
