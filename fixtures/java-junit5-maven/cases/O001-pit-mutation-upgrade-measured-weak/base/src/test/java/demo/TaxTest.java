package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class TaxTest {
  @Test
  void chargesTwentyPercent() {
    assertEquals(2, new Tax().tax(10));
  }
}
