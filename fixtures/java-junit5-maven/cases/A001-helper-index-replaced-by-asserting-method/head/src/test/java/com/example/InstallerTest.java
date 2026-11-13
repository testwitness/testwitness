package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.support.InstallResult;
import org.junit.jupiter.api.Test;

class InstallerTest {

  @Test
  void createsPackageDirectory() {
    InstallResult result = InstallResult.install("initools");
    result.hasCreated("lib/initools");
    result.hasCreated("lib/initools/module-info.class");
    assertEquals(0, result.code());
  }
}
