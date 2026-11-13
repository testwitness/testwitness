# apache/camel#5996

Adds assertions to tests that had none across 39 files to satisfy a code quality rule, mostly assertDoesNotThrow, assertNotNull or real equality checks, and renames a few misspelled tests. The engine reports O002 low smoke on the renamed tests. Honest control.
