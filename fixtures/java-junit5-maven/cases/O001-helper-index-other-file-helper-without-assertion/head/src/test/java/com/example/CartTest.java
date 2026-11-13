package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.support.CartPrinter;
import org.junit.jupiter.api.Test;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void printsTwoLines() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    CartPrinter.dump(cart);
  }
}
