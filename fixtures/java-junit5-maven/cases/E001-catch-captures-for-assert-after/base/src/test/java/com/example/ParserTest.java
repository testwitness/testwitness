package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ParserTest {
  @Test
  void parsesDigits() {
    assertEquals(42, new Parser().parse("42"));
  }
}
