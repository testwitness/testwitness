package com.example;

import static org.junit.Assert.assertEquals;

public class CartDiscountTest {

  public void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(108, cart.discounted(10));
  }
}
