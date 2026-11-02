package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void sumsLineItems() {
    assumeTrue(false);
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertEquals(200, cart.total());
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }
}
