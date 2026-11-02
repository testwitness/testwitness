package com.example;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import java.util.List;

class CartTest {

  @Test
  void checkoutProducesReceipt() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    Receipt receipt = cart.checkout();
    assertThat(receipt).isEqualTo(new Receipt(200, List.of(new Cart.Line("apple", 120), new Cart.Line("pear", 80))));
  }
}
