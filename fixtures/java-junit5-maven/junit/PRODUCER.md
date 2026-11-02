# Producer

NOT PRODUCED in this workspace. No XML is committed for this fixture yet.

Intended producer: Maven 3.9.11, maven-surefire-plugin 3.5.2 with `rerunFailingTestsCount=2`, JUnit Jupiter 5.11.4, AssertJ 3.26.3, Mockito 5.14.2, Java 21 (`project/pom.xml`).

Why it is missing: the workspace proxy denies `repo.maven.apache.org` and `repo1.maven.org` (HTTP 403 on CONNECT, logged as `connect_rejected` by the agent proxy), so Maven cannot resolve even `maven-resources-plugin`. Unlike JUnit 4 and TestNG, no JUnit Jupiter jars exist anywhere on this machine, so there is no offline fallback.

Command to run once Maven Central is reachable (from `project/`):

    mvn -B test -Dmaven.test.failure.ignore=true && cp target/surefire-reports/TEST-*.xml ../junit/

Expected: 1 disabled (skipped), 3 parameterised cases, 2 nested class tests, 1 failure, and `flakyFailure` elements for `flakyPassesOnSecondAttempt` (static counter, fails on attempt 1, passes on attempt 2).

Gradle fallback checked on 2 Nov 2026: `~/.m2/repository` holds no jars and `~/.gradle/caches/modules-2` is empty, and a Gradle probe with `--offline` reports `No cached version of org.junit.jupiter:junit-jupiter:5.11.4 available for offline mode`. The only JUnit Platform jars on the machine are `junit-platform-{commons,engine,launcher}-1.8.2` inside the Gradle distribution, with no Jupiter API or engine, so no offline build is possible.
