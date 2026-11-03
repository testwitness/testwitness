package demo;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class StackPeekTest {
    @Test
    public void popAfterTwoPushesLeavesOne() {
        Stack<String> stack = new Stack<>();
        stack.push("a");
        stack.push("b");
        stack.pop();
        assertEquals(1, stack.size());
    }
}
