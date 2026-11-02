package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartTest {

  @Test
  void handlesEmpty() {
    Cart cart = new Cart();
    assertEquals(0, cart.total());
  }

  @Test
  void sumsLineItems() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.add("pear", 80);
    assertEquals(200, cart.total());
  }

  @Test
  void rejectsNegativePrice() {
    Cart cart = new Cart();
    assertThrows(IllegalArgumentException.class, () -> cart.add("apple", -1));
  }

  @Test
  void checkoutKeepsLines() {
    Cart cart = new Cart();
    cart.add("apple", 120);
    cart.checkout();
    verifyLines(cart, "apple");
  }

  private void verifyLines(Cart cart, String... skus) {
    assertEquals(skus.length, cart.size());
    for (int i = 0; i < skus.length; i++) {
      assertEquals(skus[i], cart.lines().get(i).sku());
    }
  }
}
