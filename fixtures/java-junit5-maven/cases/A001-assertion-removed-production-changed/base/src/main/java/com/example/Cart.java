package com.example;

import java.util.ArrayList;
import java.util.List;

public class Cart {
  private final List<Line> lines = new ArrayList<>();

  public void add(String sku, int priceCents) {
    if (priceCents < 0) {
      throw new IllegalArgumentException("price must not be negative");
    }
    lines.add(new Line(sku, priceCents));
  }

  public int total() {
    int sum = 0;
    for (Line l : lines) {
      sum += l.priceCents();
    }
    return sum;
  }

  public int size() {
    return lines.size();
  }

  public boolean isEmpty() {
    return lines.isEmpty();
  }

  public List<Line> lines() {
    return List.copyOf(lines);
  }

  public record Line(String sku, int priceCents) {}
}
