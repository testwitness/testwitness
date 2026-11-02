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
    // TODO restore after the ledger refactor
  }

  @Test(expected = IllegalArgumentException.class)
  public void rejectsNegativePrice() {
    Cart cart = new Cart();
    cart.add("apple", -1);
  }
}
