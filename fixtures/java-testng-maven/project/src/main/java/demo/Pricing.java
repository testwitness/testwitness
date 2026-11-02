package demo;

public class Pricing {
    public double withTax(double net, double rate) {
        if (rate < 0) {
            throw new IllegalArgumentException("rate must be non negative");
        }
        return Math.round(net * (1 + rate) * 100.0) / 100.0;
    }
}
