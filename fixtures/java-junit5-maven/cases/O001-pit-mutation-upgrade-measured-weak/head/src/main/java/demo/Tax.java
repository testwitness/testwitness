package demo;

public class Tax {
  public int tax(int amount) {
    return amount / 5;
  }

  public int exemptTax(int amount, String reason) {
    if (!reason.isEmpty()) {
      return 0;
    }
    return tax(amount);
  }
}
