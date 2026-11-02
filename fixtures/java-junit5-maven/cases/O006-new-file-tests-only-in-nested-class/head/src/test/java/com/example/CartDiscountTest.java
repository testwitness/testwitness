package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Nested;

class CartDiscountTest {

  @Nested
  class WhenTenPercent {
    @Test
    void appliesPercentageDiscount() {
      Cart cart = new Cart();
      cart.add("apple", 120);
      assertEquals(108, cart.discounted(10));
    }
  }
}
