package com.example;

import org.testng.annotations.Test;
import static org.testng.Assert.*;

@Test
public class CartDiscountTest {

  public void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(cart.discounted(10), 108);
  }
}
