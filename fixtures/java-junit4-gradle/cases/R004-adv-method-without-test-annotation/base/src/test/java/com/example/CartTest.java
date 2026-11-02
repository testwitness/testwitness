package com.example;

import org.junit.Test;
import static org.junit.Assert.*;

public class CartTest {

  @Test
  public void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  public void sumsLineItemsSlowly() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    assertEquals(120, cart.total());
  }
}
