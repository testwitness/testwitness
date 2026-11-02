package com.example.pricing;

import com.example.Cart;
import static org.junit.jupiter.api.Assertions.assertEquals;

class CartTest {

  void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(108, cart.discounted(10));
  }
}
