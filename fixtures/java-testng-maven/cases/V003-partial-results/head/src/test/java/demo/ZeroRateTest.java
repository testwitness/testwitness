package demo;

import static org.testng.Assert.assertEquals;

import org.testng.annotations.Test;

public class ZeroRateTest {
    private final Pricing pricing = new Pricing();

    @Test
    public void zeroRateKeepsNet() {
        assertEquals(pricing.withTax(42, 0), 42.0);
    }
}
