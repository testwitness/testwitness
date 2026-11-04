package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.assertj.core.api.Assertions.assertThat;

class ReceiptTest {

  @Test
  void printsTotals() {
    Receipt receipt = Receipts.sample();
    assertThat(receipt.lines()).hasSize(3);
  }

  @Test
  void startsEmpty() {
    assertEquals(0, new Cart().lines().size());
  }
}
