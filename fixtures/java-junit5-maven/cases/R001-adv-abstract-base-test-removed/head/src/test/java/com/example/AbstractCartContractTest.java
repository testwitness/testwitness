package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

abstract class AbstractCartContractTest {

  abstract Cart newCart();

  @Test
  void startsEmpty() {
    Cart cart = newCart();
    assertTrue(cart.isEmpty());
  }
}
