package com.example;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class CartTest {

  @Test
  void checkoutProducesReceipt() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    Receipt receipt = cart.checkout();
    assertThat(receipt.total()).isNotNull();
    assertThat(receipt.lines()).hasSize(2);
  }
}
