package com.example;

public class Parser {
  public int parse(String s) {
    if (s.isEmpty()) throw new IllegalArgumentException("empty input");
    return Integer.parseInt(s);
  }
}
