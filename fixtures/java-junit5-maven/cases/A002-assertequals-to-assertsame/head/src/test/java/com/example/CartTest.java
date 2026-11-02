package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartTest {

  @Test
  void checkoutReturnsSameReceiptTwice() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    Receipt first = cart.checkout();
    assertSame(first, cart.checkout());
  }
}
