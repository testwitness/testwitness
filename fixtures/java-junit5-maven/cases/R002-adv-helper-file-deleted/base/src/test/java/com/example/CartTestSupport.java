package com.example;


final class CartTestSupport {

  static Cart cartWith(int... prices) {
    Cart cart = new Cart();
    for (int p : prices) {
      cart.add("sku", p);
    }
    return cart;
  }
}
