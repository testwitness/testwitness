package demo;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class StackOrderTest {
    @Test
    public void popsInReverseOrder() {
        Stack<String> stack = new Stack<>();
        stack.push("a");
        stack.push("b");
        assertEquals("b", stack.pop());
        assertEquals("a", stack.pop());
    }
}
