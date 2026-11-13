# apache/shardingsphere#25660

Adds real assertions to two tests and turns a commented out test into a test marked @Disabled with the reason that H2 does not support incremental mode. The new test is born disabled. Stresses R010 on JUnit 5 @Disabled for a test that was previously commented out.
