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
  void appliesDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120)
    assertEquals(108, cart.discounted(10));
  }

  @Test
  void sumsLineItems() {
    // TODO restore after the ledger refactor
  }
}
