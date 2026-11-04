package demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;

class CalculatorAddOrderTest {
    private final Calculator calculator = new Calculator(mock(Notifier.class));

    @Test
    void additionIsCommutative() {
        assertThat(calculator.add(2, 7)).isEqualTo(calculator.add(7, 2));
    }
}
