package demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgeTest {
  @Test
  void countsEighteenAsAdult() {
    assertTrue(new Age().isAdult(18));
  }

  @Test
  void countsSeventeenAsMinor() {
    assertFalse(new Age().isAdult(17));
  }
}
