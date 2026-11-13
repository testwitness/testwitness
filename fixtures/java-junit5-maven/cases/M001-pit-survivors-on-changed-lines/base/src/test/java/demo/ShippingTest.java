package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShippingTest {
  @Test
  void chargesAFee() {
    assertTrue(new Shipping().fee(1) > 0);
  }
}
