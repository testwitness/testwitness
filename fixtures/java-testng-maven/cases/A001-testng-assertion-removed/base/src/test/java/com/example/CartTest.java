package com.example;

import org.testng.annotations.Test;
import static org.testng.Assert.*;

public class CartTest {

  @Test
  public void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(cart.total(), 0);
  }

  @Test
  public void sumsLineItems() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertEquals(cart.total(), 200);
    assertEquals(cart.size(), 2);
  }

  @Test(expectedExceptions = IllegalArgumentException.class)
  public void rejectsNegativePrice() {
    Cart cart = new Cart();
    cart.add("apple", -1);
  }
}
