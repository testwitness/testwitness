package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LedgerTest {

  private void checkEmptyTotal() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void recordsCredit() {
    Ledger ledger = new Ledger();
    ledger.credit("acct-1", 500);
    assertEquals(500, ledger.balance("acct-1"));
  }
}
