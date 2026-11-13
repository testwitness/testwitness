package org.acme.configuration.test111;

import static org.assertj.core.api.Assertions.assertThat;

import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

/** Moved from test.test111 to the feature package; the counter is reset first. */
public class Test1 {

  @BeforeClass
  public void resetTheCounter() {
    Counter.reset();
  }

  @Test(description = "GITHUB-111")
  public void test() {
    assertThat(Counter.value()).isEqualTo(0);
  }

  @Test(description = "GITHUB-111")
  public void countsOnce() {
    Counter.increment();
    assertThat(Counter.value()).isEqualTo(1);
  }
}
