package com.example;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
import static org.junit.jupiter.api.Assertions.*;

abstract class AbstractCartContractTest {

  abstract Cart newCart();

  @Test
  void startsEmpty() {
    Cart cart = newCart();
    assertTrue(cart.isEmpty());
  }

  @Disabled
  @Test
  void totalMatchesLines() {
    Cart cart = newCart();
    cart.add("apple", 120);
    assertEquals(120, cart.total());
  }
}
