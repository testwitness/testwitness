package com.example;


abstract class AbstractCartContractTest {

  abstract Cart newCart();

  protected Cart cartWith(int... prices) {
    Cart cart = newCart();
    for (int p : prices) {
      cart.add("sku", p);
    }
    return cart;
  }
}
