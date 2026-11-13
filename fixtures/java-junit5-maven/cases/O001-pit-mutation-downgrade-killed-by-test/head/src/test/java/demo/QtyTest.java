package demo;

import org.junit.jupiter.api.Test;

class QtyTest {
  @Test
  void parsesAQuantity() {
    new Qty().parse("3");
  }
}
