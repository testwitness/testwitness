# apache/shardingsphere#25657

Removes an assertDoesNotThrow wrapper around two validator calls; an exception still fails the test. The engine reports A001 medium on both tests: false positives, since an unwrapped call that throws fails the test just the same. Honest control for A001.
