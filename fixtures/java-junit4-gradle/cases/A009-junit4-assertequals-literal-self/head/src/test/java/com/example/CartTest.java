package com.example;

import org.junit.Test;
import static org.junit.Assert.*;

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
    assertEquals("ok", "ok");
  }

  @Test(expected = IllegalArgumentException.class)
  public void rejectsNegativePrice() {
    Cart cart = new Cart();
    cart.add("apple", -1);
  }
}
