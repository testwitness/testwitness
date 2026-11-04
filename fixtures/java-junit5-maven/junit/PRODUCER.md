# Producer

- Produced on 4 Nov 2026 by the maintainer on a Mac (macOS arm64, os.version 15.7.7), not in the agent workspace. The files are the unedited Surefire output.
- Build: Maven 3.9.x, maven-surefire-plugin 3.5.2 with `rerunFailingTestsCount=2` (see `project/pom.xml`), openjdk 21 (21.0.13, Homebrew).
- Framework: JUnit Jupiter 5.11.4 (platform 1.11.4), AssertJ 3.26.3, Mockito 5.14.2.
- XML writer: Surefire's built in report (`target/surefire-reports/TEST-*.xml`, schema version 3.0.2).

## Command (run from `project/`)

    mvn -B test -Dmaven.test.failure.ignore=true

Then `target/surefire-reports/TEST-*.xml` was copied to `junit/`. Two files were written: `TEST-demo.CalculatorTest$Division.xml` and `TEST-demo.CalculatorTest.xml`.

## Quirks the golden cases depend on

1. Surefire wrote the outer class tests into `TEST-demo.CalculatorTest$Division.xml`, not into the outer class file. That file holds addsTwoNumbers, subtractsTwoNumbers (skipped), failsOnPurpose (failure), flakyPassesOnSecondAttempt (failure on the first attempt), warnsOnDivisionByZero and squaresArePositive(int)[1] to [3], together with the two @Nested tests dividesEvenly and truncatesRemainder (classname `demo.CalculatorTest$Division`). `TEST-demo.CalculatorTest.xml` holds only the reruns: flakyPassesOnSecondAttempt (passed on retry) and failsOnPurpose (failure plus a `rerunFailure` child).
2. The reader keys are therefore calculatortest::addstwonumbers, calculatortest$division::dividesevenly and so on, and the parametrised rows fold to one key, calculatortest::squaresarepositive. flakyPassesOnSecondAttempt is read as flaky because it failed in one file and passed in the other. failsOnPurpose stays failed because it failed in both.

Totals as read: 8 tests, 6 passed, 1 failed, 0 errored, 1 skipped, 1 flaky.
