package demo;

import static org.junit.Assert.assertNotEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.Test;

public class RetryTest {
    // Counts its own runs in a file next to build.gradle; fails on every fourth run (the fourth, eighth, ...).
    @Test
    public void settlesTheLedger() throws Exception {
        Path counter = Paths.get(".retry-counter");
        int runs = Files.exists(counter) ? Integer.parseInt(Files.readString(counter).trim()) : 0;
        Files.writeString(counter, String.valueOf(runs + 1));
        assertNotEquals(3, runs % 4);
    }
}
