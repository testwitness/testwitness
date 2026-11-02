package com.example;

import org.junit.Test;
import static org.junit.Assert.*;
import org.junit.Ignore;

public class CartTest {

  @Test
  public void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  public void sumsLineItems() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertEquals(200, cart.total());
  }

  @Test(expected = IllegalArgumentException.class)
  public void rejectsNegativePrice() {
    Cart cart = new Cart();
    cart.add("apple", -1);
  }

  @Ignore
  @Test
  public void appliesPercentageDiscount() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(108, cart.discounted(10));
  }
}
