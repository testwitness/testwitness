package demo;

public class Shipping {
  public double fee(double weightKg) {
    return weightKg > 0 ? 5 : 0;
  }
}
