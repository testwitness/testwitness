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
  @ValueSource(ints = {120, 80, 300})
  void totalsSingleItem(int price) {
    Cart cart = new Cart();
    cart.add("sku", price);
    assertEquals(price, cart.total());
  }
}
