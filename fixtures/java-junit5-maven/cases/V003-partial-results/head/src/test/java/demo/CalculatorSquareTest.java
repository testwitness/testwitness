package demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;

class CalculatorSquareTest {
    private final Calculator calculator = new Calculator(mock(Notifier.class));

    @Test
    void squareOfNegativeIsPositive() {
        assertThat(calculator.square(-4)).isEqualTo(16);
    }
}
