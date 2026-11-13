package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.support.InstallResult;
import org.junit.jupiter.api.Test;

class InstallerTest {

  @Test
  void createsPackageDirectory() {
    InstallResult result = InstallResult.install("initools");
    assertTrue(result.filesCreated().contains("lib/initools"));
    assertTrue(result.filesCreated().contains("lib/initools/module-info.class"));
    assertEquals(0, result.code());
  }
}
