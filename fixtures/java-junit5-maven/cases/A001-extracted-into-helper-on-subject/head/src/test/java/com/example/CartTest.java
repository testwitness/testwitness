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
    assertTotals(cart, 200, 2);
  }

  private static void assertTotals(Cart cart, int total, int size) {
    assertEquals(total, cart.total());
    assertEquals(size, cart.size());
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }
}
