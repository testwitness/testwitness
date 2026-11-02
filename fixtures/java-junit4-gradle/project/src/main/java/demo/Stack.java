package demo;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.NoSuchElementException;

public class Stack<T> {
    private final Deque<T> items = new ArrayDeque<>();

    public void push(T item) {
        items.push(item);
    }

    public T pop() {
        if (items.isEmpty()) {
            throw new NoSuchElementException("stack is empty");
        }
        return items.pop();
    }

    public int size() {
        return items.size();
    }
}
