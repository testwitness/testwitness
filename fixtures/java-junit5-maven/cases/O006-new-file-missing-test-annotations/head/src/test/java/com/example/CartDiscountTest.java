package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CartDiscountTest {

  void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(108, cart.discounted(10));
  }

  void zeroPercentIsIdentity() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(120, cart.discounted(0));
  }
}
