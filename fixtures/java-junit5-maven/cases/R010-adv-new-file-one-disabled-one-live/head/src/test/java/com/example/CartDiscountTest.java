package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Disabled;

class CartDiscountTest {

  @Test
  void zeroPercentIsIdentity() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(120, cart.discounted(0));
  }

  @Disabled
  @Test
  void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(108, cart.discounted(10));
  }
}
