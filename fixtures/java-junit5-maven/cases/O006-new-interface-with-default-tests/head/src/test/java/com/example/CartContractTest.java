package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

interface CartContractTest {

  Cart newCart();

  @Test
  default void startsEmpty() {
    assertTrue(newCart().isEmpty());
  }
}
