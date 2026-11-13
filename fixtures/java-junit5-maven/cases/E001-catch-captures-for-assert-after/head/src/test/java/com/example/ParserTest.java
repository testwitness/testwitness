package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;

class ParserTest {
  @Test
  void parsesDigits() {
    assertEquals(42, new Parser().parse("42"));
  }

  @Test
  void rejectsEmptyInput() {
    Exception caught = null;
    try {
      new Parser().parse("");
    } catch (Exception e) {
      caught = e;
    }
    assertNotNull(caught);
    assertEquals("empty input", caught.getMessage());
  }
}
