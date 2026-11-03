package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  static Stream<Integer> prices() {
    return Stream.of(120, 80, 300);
  }

  @ParameterizedTest
  @MethodSource("prices")
  void totalsSingleItem(int price) {
    Cart cart = new Cart();
    cart.add("sku", price);
    assertEquals(price, cart.total());
  }
}
