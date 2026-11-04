package demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CalculatorTest {
    private static final AtomicInteger FLAKY_ATTEMPTS = new AtomicInteger();

    private final Notifier notifier = mock(Notifier.class);
    private final Calculator calculator = new Calculator(notifier);

    @Test
    void addsTwoNumbers() {
        assertThat(calculator.add(2, 3)).isEqualTo(5);
        assertThat(calculator.add(-2, 3)).isEqualTo(1);
    }

    @Test
    void warnsOnDivisionByZero() {
        assertThatThrownBy(() -> calculator.divide(1, 0)).isInstanceOf(ArithmeticException.class);
        verify(notifier).warn("division by zero");
    }

    @Disabled("not implemented yet")
    @Test
    void subtractsTwoNumbers() {
        assertThat(calculator.add(5, -3)).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3})
    void squaresArePositive(int value) {
        assertThat(calculator.square(value)).isGreaterThan(0);
    }

    @Test
    void failsOnPurpose() {
        assertThat(calculator.add(1, 1)).isEqualTo(3);
    }

    @Test
    void flakyPassesOnSecondAttempt() {
        int attempt = FLAKY_ATTEMPTS.incrementAndGet();
        assertThat(attempt).as("attempt number").isGreaterThan(1);
    }

    @Nested
    class Division {
        @Test
        void dividesEvenly() {
            assertThat(calculator.divide(10, 2)).isEqualTo(5);
        }

        @Test
        void truncatesRemainder() {
            assertThat(calculator.divide(7, 2)).isEqualTo(3);
        }
    }
}
