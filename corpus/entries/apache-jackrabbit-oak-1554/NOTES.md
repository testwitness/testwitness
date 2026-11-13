# apache/jackrabbit-oak#1554

Adds two assumeTrue calls that exclude flaky full GC mode combinations from a parametrised test. Weakened for those combinations. The engine reports nothing here (missed). Stresses R003 on JUnit assumptions excluding parameter values.
