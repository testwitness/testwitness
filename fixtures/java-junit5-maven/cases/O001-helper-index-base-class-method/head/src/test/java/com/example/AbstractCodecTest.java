package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

abstract class AbstractCodecTest {

  protected abstract Codec codec();

  protected void roundTrips(String value) {
    assertEquals(value, codec().decode(codec().encode(value)));
  }
}
