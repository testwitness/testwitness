package demo;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collection;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.junit.runners.Parameterized.Parameters;

@RunWith(Parameterized.class)
public class StackSizeTest {
    private final int pushes;

    public StackSizeTest(int pushes) {
        this.pushes = pushes;
    }

    @Parameters(name = "{index}: pushes={0}")
    public static Collection<Object[]> data() {
        return Arrays.asList(new Object[][] {{1}, {2}, {3}});
    }

    @Test
    public void sizeMatchesPushes() {
        Stack<Integer> stack = new Stack<>();
        for (int i = 0; i < pushes; i++) {
            stack.push(i);
        }
        assertEquals(pushes, stack.size());
    }
}
