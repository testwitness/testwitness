package com.example.support;

import java.util.List;

public final class InstallResult {
  private final List<String> filesCreated;
  private final int code;

  public InstallResult(List<String> filesCreated, int code) {
    this.filesCreated = filesCreated;
    this.code = code;
  }

  public List<String> filesCreated() {
    return filesCreated;
  }

  public int code() {
    return code;
  }

  public void didCreate(String path) {
    if (!filesCreated.contains(path)) {
      throw new AssertionError(path + " not created: " + filesCreated);
    }
  }

  public static InstallResult install(String name) {
    String root = "lib/" + name;
    return new InstallResult(List.of(root, root + "/module-info.class"), 0);
  }
}
