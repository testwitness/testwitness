package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReceiptTest {

  @Test
  void printsTotals() {
    Receipt receipt = Receipts.sample();
    assertFalse(receipt.lines().isEmpty());
  }

  @Test
  void startsEmpty() {
    assertEquals(0, new Cart().lines().size());
  }
}
