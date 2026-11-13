package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MoneyTest {
  @Test
  void formatsDollars() {
    assertEquals("$5.00", new Money().format(500));
  }

  @Test
  void returnsTextForEuros() {
    assertTrue(new Money().format(500, "€").contains("5"));
  }
}
