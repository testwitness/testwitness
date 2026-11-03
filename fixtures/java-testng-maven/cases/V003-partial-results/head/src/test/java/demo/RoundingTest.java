package demo;

import static org.testng.Assert.assertEquals;

import org.testng.annotations.Test;

public class RoundingTest {
    private final Pricing pricing = new Pricing();

    @Test
    public void roundsToCents() {
        assertEquals(pricing.withTax(10, 0.333), 13.33);
    }
}
