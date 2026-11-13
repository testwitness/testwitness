package com.example.samples;

import org.testng.SkipException;
import org.testng.annotations.Test;

/** Input for the command line tests: a class whose only test always skips. */
public class RunFailureSamples {

  public static class AllSkipped {
    @Test
    public void test() {
      throw new SkipException("always skipped on purpose");
    }
  }
}
