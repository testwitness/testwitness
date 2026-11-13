package test.issue565;

import static org.testng.Assert.assertEquals;

import org.testng.annotations.Test;

public class Issue565Test {

  @Test
  public void ThereShouldNotBeDeadlockWhenGroupByInstanceAndGroupDependencyUsed() {
    Suite suite = Suite.parallelByInstances(5);
    suite.run();
    assertEquals(suite.failed(), 0);
  }
}
