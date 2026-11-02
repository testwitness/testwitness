package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CartDiscountTest {

  void appliesPercentageDiscount() {
    Cart cart = new Cart()
    assertEquals(108, cart.discounted(10));
  }
}
