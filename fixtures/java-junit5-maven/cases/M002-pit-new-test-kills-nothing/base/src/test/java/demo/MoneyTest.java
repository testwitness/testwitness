package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class MoneyTest {
  @Test
  void formatsDollars() {
    assertEquals("$5", new Money().format(500));
  }
}
