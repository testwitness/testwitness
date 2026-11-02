# Producer

The intended producer is Maven surefire 3.5.2 with TestNG 7.10.2 (`project/pom.xml`). Maven could not run in this workspace: the proxy denies `repo.maven.apache.org` and `repo1.maven.org` with 403 on CONNECT, so not even the core Maven plugins resolve. The committed XML therefore comes from an offline fallback that runs the same sources:

- Build: Gradle 8.14.3 (`/opt/gradle/bin/gradle`), Java 21 (OpenJDK), `useTestNG { useDefaultListeners = true }`, `ignoreFailures = true` (`project/build.gradle`).
- Framework: TestNG 6.3.1 with jcommander 1.78, bsh 2.0b6 and snakeyaml 2.0, all taken from `$GRADLE_HOME/lib/plugins` because Maven Central is unreachable. TestNG 6.3.1 is old; the native result format has been stable but a surefire run with TestNG 7.x should be re recorded when network access allows.

## Files

- `TEST-demo.PricingTest.xml`: Gradle's own JUnit XML writer (`build/test-results/test/`). This is Gradle format, not surefire format.
- `testng-results.xml`: TestNG's native results file (`build/reports/tests/test/testng-results.xml`), identical in shape to what surefire writes to `target/surefire-reports/testng-results.xml`.
- `testng-junitreports/TEST-demo.PricingTest.xml`: TestNG's own `JUnitReportReporter` output (`build/reports/tests/test/junitreports/`), kept because it encodes assertion failures as `<error>`.

## Command (run from `project/`)

    /opt/gradle/bin/gradle --offline --no-daemon -q test \
      && cp build/test-results/test/TEST-*.xml build/reports/tests/test/testng-results.xml ../junit/ \
      && cp build/reports/tests/test/junitreports/*.xml ../junit/testng-junitreports/

Console summary: `6 tests completed, 1 failed`. The `@Test(enabled = false)` method is absent from every output.
