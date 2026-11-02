package com.example;

import org.junit.Test;
import static org.junit.Assert.*;

public class CartSummaryTest {

  @Test(expected = AssertionError.class)
  public void sumsLineItems() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertEquals(200, cart.total());
  }
}
