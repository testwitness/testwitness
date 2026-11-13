# Producer

- Build: Gradle 8.14.3 (`/opt/gradle/bin/gradle`), OpenJDK 21.0.12, JUnit 4.13.2 from `$GRADLE_HOME/lib`, the same setup as `fixtures/java-junit4-gradle/junit/PRODUCER.md`.
- Test: `base/src/test/java/demo/RetryTest.java` of this case, copied into a temporary copy of `fixtures/java-junit4-gradle/project`. It counts its own runs in `.retry-counter` and fails on every fourth run, so five runs give pass, pass, pass, fail, pass.
- Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after Gradle wrote it.

## Command (run from the temporary project copy, five times)

    rm -f .retry-counter
    for i in 1 2 3 4 5; do
      gradle --offline --no-daemon -q test --tests demo.RetryTest --rerun
      cp build/test-results/test/TEST-demo.RetryTest.xml TEST-demo.RetryTest-run-$i.xml
    done

Console summary of the fourth run: `1 test completed, 1 failed`.
