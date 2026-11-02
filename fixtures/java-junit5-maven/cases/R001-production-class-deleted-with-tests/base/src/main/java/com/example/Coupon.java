package com.example;

public class Coupon {
  private final int percent;

  public Coupon(int percent) {
    this.percent = percent;
  }

  public int apply(int cents) {
    return cents * (100 - percent) / 100;
  }
}
