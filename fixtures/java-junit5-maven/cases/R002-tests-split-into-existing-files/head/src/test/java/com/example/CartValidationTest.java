package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartValidationTest {

  @Test
  void rejectsBlankSku() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("", 10));
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }
}
