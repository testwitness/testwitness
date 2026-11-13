package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class PaymentsTest {
  @Test
  void charges() {
    assertEquals(3, new Calculator().add(1, 2));
  }
}
