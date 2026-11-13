package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class JsonCodecTest extends AbstractCodecTest {

  @Override
  protected Codec codec() {
    return new JsonCodec();
  }

  @Test
  void encodesPlainText() {
    assertEquals("\"a\"", codec().encode("a"));
  }
}
