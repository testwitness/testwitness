package com.example;

import static org.testng.Assert.assertEquals;

public class CartDiscountTest {

  public void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(cart.discounted(10), 108);
  }
}
