package org.acme.concurrency.issue565;

import static org.assertj.core.api.Assertions.assertThat;

import org.testng.annotations.Test;

public class Issue565Test {

  @Test(description = "GITHUB-565")
  public void aGroupDependencyWithGroupByInstancesDoesNotDeadlock() {
    Suite suite = Suite.parallelByInstances(5);
    suite.run();
    assertThat(suite.failed()).isZero();
    assertThat(suite.skipped()).isZero();
  }
}
