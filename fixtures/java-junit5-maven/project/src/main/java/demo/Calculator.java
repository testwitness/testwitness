package demo;

public class Calculator {
    private final Notifier notifier;

    public Calculator(Notifier notifier) {
        this.notifier = notifier;
    }

    public int add(int a, int b) {
        return a + b;
    }

    public int square(int x) {
        return x * x;
    }

    public int divide(int a, int b) {
        if (b == 0) {
            notifier.warn("division by zero");
            throw new ArithmeticException("division by zero");
        }
        return a / b;
    }
}
