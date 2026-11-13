package demo;

public class Money {
  public String format(int cents) {
    return format(cents, "$");
  }

  public String format(int cents, String currency) {
    String amount = (cents / 100) + "." + String.format("%02d", cents % 100);
    return currency.equals("€") ? amount + " €" : currency + amount;
  }
}
