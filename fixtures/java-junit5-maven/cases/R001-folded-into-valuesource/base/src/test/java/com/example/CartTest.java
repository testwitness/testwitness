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

  @Test
  void totalsSingleApple() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(120, cart.total());
  }

  @Test
  void totalsSinglePear() {
    Cart cart = new Cart();
    cart.add("pear", 80);
    assertEquals(80, cart.total());
  }

  @Test
  void totalsSingleFig() {
    Cart cart = new Cart();
    cart.add("fig", 300);
    assertEquals(300, cart.total());
  }
}
