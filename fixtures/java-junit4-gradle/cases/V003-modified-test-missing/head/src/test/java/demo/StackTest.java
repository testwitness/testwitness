package demo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.NoSuchElementException;
import org.junit.Ignore;
import org.junit.Test;

public class StackTest {
    @Test
    public void pushIncreasesSize() {
        Stack<String> stack = new Stack<>();
        stack.push("a");
        stack.push("b");
        assertEquals(2, stack.size());
    }

    @Test
    public void popReturnsLastPushed() {
        Stack<String> stack = new Stack<>();
        stack.push("a");
        stack.push("b");
        assertEquals("b", stack.pop());
    }

    @Test(expected = NoSuchElementException.class)
    public void popOnEmptyThrows() {
        new Stack<String>().pop();
    }

    @Ignore("not ready")
    @Test
    public void peekDoesNotRemove() {
        assertTrue(false);
    }

    @Test
    public void failsOnPurpose() {
        Stack<String> stack = new Stack<>();
        stack.push("a");
        assertEquals(2, stack.size());
    }
}
