package com.example.support;


final class CartFixtures {

  static Cart cartWith(int... prices) {
    Cart cart = new Cart();
    for (int p : prices) {
      cart.add("sku", p);
    }
    return cart;
  }
}
