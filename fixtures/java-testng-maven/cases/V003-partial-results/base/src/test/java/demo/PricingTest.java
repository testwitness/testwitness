package demo;

import static org.testng.Assert.assertEquals;

import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

public class PricingTest {
    private final Pricing pricing = new Pricing();

    @Test
    public void addsTax() {
        assertEquals(pricing.withTax(100, 0.2), 120.0);
    }

    @Test(expectedExceptions = IllegalArgumentException.class)
    public void rejectsNegativeRate() {
        pricing.withTax(100, -0.1);
    }

    @Test(enabled = false)
    public void disabledTest() {
        assertEquals(1, 2);
    }

    @DataProvider(name = "rates")
    public Object[][] rates() {
        return new Object[][] {
            {100.0, 0.0, 100.0},
            {100.0, 0.1, 110.0},
            {19.99, 0.25, 24.99},
        };
    }

    @Test(dataProvider = "rates")
    public void appliesRates(double net, double rate, double expected) {
        assertEquals(pricing.withTax(net, rate), expected);
    }

    @Test
    public void failsOnPurpose() {
        assertEquals(pricing.withTax(100, 0.2), 999.0);
    }
}
