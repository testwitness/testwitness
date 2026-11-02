package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Nested;

class CartTest {

  @Nested
  class WhenEmpty {
    @Test
    void totalIsZero() {
      Cart cart = new Cart();
      assertEquals(0, cart.total());
    }

    @Test
    void sizeIsZero() {
      Cart cart = new Cart();
      assertEquals(0, cart.size());
    }

    @Test
    void checkoutProducesReceipt() {
      Cart cart = new Cart();
      assertEquals(0, cart.checkout().total());
    }
  }

  @Nested
  class WhenOnlyFreeItems {
    @Test
    void totalIsZero() {
      Cart cart = new Cart();
      cart.add("voucher", 0);
      assertEquals(0, cart.total());
    }

    @Test
    void sizeIsOne() {
      Cart cart = new Cart();
      cart.add("voucher", 0);
      assertEquals(1, cart.size());
    }

    @Test
    void checkoutProducesReceipt() {
      Cart cart = new Cart();
      cart.add("voucher", 0);
      assertNotNull(cart.checkout());
    }
  }
}
