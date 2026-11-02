package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CouponTest {

  @Test
  void appliesPercent() {
    Coupon coupon = new Coupon(10);
    assertEquals(90, coupon.apply(100));
  }
}
