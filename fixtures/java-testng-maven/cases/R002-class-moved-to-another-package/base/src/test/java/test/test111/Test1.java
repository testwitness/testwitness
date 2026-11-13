package test.test111;

import static org.testng.Assert.assertEquals;

import org.testng.annotations.Test;

public class Test1 {

  @Test
  public void test() {
    assertEquals(Counter.value(), 0);
  }

  @Test
  public void countsOnce() {
    Counter.increment();
    assertEquals(Counter.value(), 1);
  }
}
