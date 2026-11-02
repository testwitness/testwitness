package com.example;

import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.atLeastOnce;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void checkoutRecordsEachLine() {
    Ledger ledger = mock(Ledger.class);
    Cart cart = new Cart(ledger);
    cart.add("apple", 120);
    cart.checkout();
    verify(ledger).record("apple", 120);
  }
}
