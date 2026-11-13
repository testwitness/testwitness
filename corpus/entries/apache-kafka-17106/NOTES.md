# apache/kafka#17106

Lets Gradle test tasks ignore failures on GitHub Actions only to collect JUnit XML, then fails the task in doLast if any suite failed, and marks the JUnit parsing step continue-on-error. Test failures still fail the build. The engine reports W002 high on the parsing step, which runs no tests: a false positive. Honest control for W002 and W003.
