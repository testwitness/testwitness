package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReceiptTest {

  @Test
  void printsTotals() {
    Receipt receipt = Receipts.sample();
    assertTrue(receipt.summary().contains("12.50"));
  }

  @Test
  void startsEmpty() {
    assertEquals(0, new Cart().lines().size());
  }
}
