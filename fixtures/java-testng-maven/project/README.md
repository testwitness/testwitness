# java-testng-maven

Intended: `mvn test -Dmaven.test.failure.ignore=true` then copy `target/surefire-reports/TEST-*.xml` and `target/surefire-reports/testng-results.xml` to `../junit/`. Offline fallback actually used here: `/opt/gradle/bin/gradle --offline test` (see `../junit/PRODUCER.md`).
