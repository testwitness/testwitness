package com.example;

import com.example.support.InstallResult;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class InstallerTest {

  @Test
  void createsPackageDirectory() {
    InstallResult result = InstallResult.install("guava");
    assertTrue(result.filesCreated().contains("lib/guava"));
    System.out.println(result.filesCreated());
    assertEquals(0, result.code());
  }

  @Test
  void reportsSuccess() {
    InstallResult result = InstallResult.install("guava");
    assertEquals(0, result.code());
  }
}
