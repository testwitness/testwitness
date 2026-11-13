package demo;

public class Shipping {
  public double fee(double weightKg, boolean express) {
    double fee = weightKg > 0 ? 5 : 0;
    if (weightKg > 10) {
      fee += (weightKg - 10) * 0.5;
    }
    if (express) {
      fee = fee * 2;
    }
    return fee;
  }
}
