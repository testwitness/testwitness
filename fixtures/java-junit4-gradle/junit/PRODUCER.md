# Producer

- Build: Gradle 8.14.3 (`/opt/gradle/bin/gradle`), Java 21 (OpenJDK), `useJUnit()` test task with `ignoreFailures = true`.
- Framework: JUnit 4.13.2 with hamcrest-core 1.3. Maven Central is denied by the workspace proxy, so `build.gradle` points `testImplementation files(...)` at the identical `junit-4.13.2.jar` and `hamcrest-core-1.3.jar` that ship in `$GRADLE_HOME/lib`. With network access the commented `mavenCentral()` lines produce the same XML.
- XML writer: Gradle's built in JUnit XML report (`build/test-results/test/TEST-*.xml`), one file per test class.

## Command (run from `project/`)

    /opt/gradle/bin/gradle --offline --no-daemon -q test && cp build/test-results/test/*.xml ../junit/

Console summary: `8 tests completed, 1 failed, 1 skipped`.
