package com.example;

import com.example.support.InstallResult;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class InstallerTest {

  @Test
  void createsPackageDirectory() {
    InstallResult result = InstallResult.install("guava");
    assertTrue(result.filesCreated().contains("lib/guava"));
    assertTrue(result.filesCreated().contains("lib/guava/module-info.class"));
    assertEquals(0, result.code());
  }

  @Test
  void reportsSuccess() {
    InstallResult result = InstallResult.install("guava");
    assertEquals(0, result.code());
  }
}
