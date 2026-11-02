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
    // TODO restore after the ledger refactor
  }

  @Test(expectedExceptions = IllegalArgumentException.class)
  public void rejectsNegativePrice() {
    Cart cart = new Cart();
    cart.add("apple", -1);
  }
}
