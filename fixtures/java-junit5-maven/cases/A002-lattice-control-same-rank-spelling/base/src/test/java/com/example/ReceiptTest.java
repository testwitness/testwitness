package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.assertj.core.api.Assertions.assertThat;

class ReceiptTest {

  @Test
  void printsTotals() {
    Receipt receipt = Receipts.sample();
    assertEquals(3, receipt.lines().size());
  }

  @Test
  void startsEmpty() {
    assertEquals(0, new Cart().lines().size());
  }
}
