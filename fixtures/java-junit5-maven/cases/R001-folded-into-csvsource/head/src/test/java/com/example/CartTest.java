package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @ParameterizedTest
  @CsvSource({"apple, 120", "pear, 80", "fig, 300"})
  void totalsSingleItem(String sku, int price) {
    Cart cart = new Cart();
    cart.add(sku, price);
    assertEquals(price, cart.total());
  }
}
