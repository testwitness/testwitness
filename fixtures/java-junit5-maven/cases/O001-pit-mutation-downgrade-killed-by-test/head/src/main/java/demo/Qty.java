package demo;

public class Qty {
  public int parse(String text) {
    int n = Integer.parseInt(text);
    if (n < 0) {
      throw new IllegalArgumentException("negative quantity: " + text);
    }
    return n;
  }
}
