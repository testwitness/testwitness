# apache/jackrabbit-oak#1497

Adds assumeTrue(fullGcMode != ORPHANS_EMPTYPROPS_KEEP_ONE_ALL_PROPS) to a parametrised integration test to exclude one flaky parameter combination, with a tracking ticket in the title. The condition is a test parameter, not a platform or optional dependency, so the combination simply stops running. Weakened. The engine reads the assume as a conditional skip and grades it low. Stresses R003 on JUnit assumptions.
