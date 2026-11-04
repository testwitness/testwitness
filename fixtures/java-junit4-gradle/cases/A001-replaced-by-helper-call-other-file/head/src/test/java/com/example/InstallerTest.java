package com.example;

import com.example.support.InstallResult;
import org.junit.Test;
import static org.junit.Assert.*;

public class InstallerTest {

  @Test
  public void createsPackageDirectory() {
    InstallResult result = InstallResult.install("guava");
    result.didCreate("lib/guava");
    result.didCreate("lib/guava/module-info.class");
    assertEquals(0, result.code());
  }

  @Test
  public void reportsSuccess() {
    InstallResult result = InstallResult.install("guava");
    assertEquals(0, result.code());
  }
}
