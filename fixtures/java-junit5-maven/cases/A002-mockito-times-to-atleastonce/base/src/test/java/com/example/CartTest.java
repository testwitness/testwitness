package com.example;

import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.atLeastOnce;

class CartTest {

  @Test
  void checkoutNotifiesLedgerOnce() {
    Ledger ledger = mock(Ledger.class);
    Cart cart = new Cart(ledger);
    cart.add("apple", 120);
    cart.checkout();
    verify(ledger, times(1)).record("apple", 120);
  }
}
