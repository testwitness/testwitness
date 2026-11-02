package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class CartAssertions {

  static void assertTotal(Cart cart, int expected) {
    assertEquals(expected, cart.total());
  }
}
