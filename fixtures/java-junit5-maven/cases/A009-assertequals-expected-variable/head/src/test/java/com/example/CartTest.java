package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void sumsLineItems() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    int expectedTotal = 120 + 80;
    assertEquals(expectedTotal, cart.total());
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }
}
