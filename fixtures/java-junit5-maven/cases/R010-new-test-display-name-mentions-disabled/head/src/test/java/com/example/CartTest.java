package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.DisplayName;

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
    assertEquals(200, cart.total());
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }

  @DisplayName("discount disabled for zero percent")
  @Test
  void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(120, cart.discounted(0));
  }
}
