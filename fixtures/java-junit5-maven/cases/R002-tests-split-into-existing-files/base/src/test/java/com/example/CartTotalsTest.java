package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartTotalsTest {

  @Test
  void totalIgnoresFreeItems() {
    Cart cart = new Cart();
    cart.add("voucher", 0);
    assertEquals(0, cart.total());
  }
}
