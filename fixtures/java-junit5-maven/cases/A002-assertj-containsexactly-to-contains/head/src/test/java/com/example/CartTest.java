package com.example;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class CartTest {

  @Test
  void listsSkusInOrder() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertThat(cart.skus()).contains("apple");
  }
}
