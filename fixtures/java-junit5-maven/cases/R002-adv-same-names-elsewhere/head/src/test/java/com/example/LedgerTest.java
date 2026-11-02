package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LedgerTest {

  @Test
  void recordsCredit() {
    Ledger ledger = new Ledger();
    ledger.credit("acct-1", 500);
    assertEquals(500, ledger.balance("acct-1"));
  }

  @Test
  void handlesEmpty() {
    Ledger ledger = new Ledger();
    assertEquals(0, ledger.balance("acct-1"));
  }

  @Test
  void sumsLineItems() {
    Ledger ledger = new Ledger();
    ledger.credit("acct-1", 120);
    ledger.credit("acct-1", 80);
    assertEquals(200, ledger.balance("acct-1"));
  }

  @Test
  void rejectsNegativePrice() {
    Ledger ledger = new Ledger();
    assertThrows(IllegalArgumentException.class, () -> ledger.credit("acct-1", -1));
  }
}
