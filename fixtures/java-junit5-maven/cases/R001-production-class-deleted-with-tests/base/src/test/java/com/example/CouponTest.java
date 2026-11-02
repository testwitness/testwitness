package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CouponTest {

  @Test
  void appliesPercent() {
    Coupon coupon = new Coupon(10);
    assertEquals(90, coupon.apply(100));
  }

  @Test
  void zeroPercentIsIdentity() {
    Coupon coupon = new Coupon(0);
    assertEquals(100, coupon.apply(100));
  }
}
