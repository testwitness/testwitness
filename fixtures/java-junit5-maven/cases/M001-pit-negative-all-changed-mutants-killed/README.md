Negative control (PIT). isAdult is new and its two new tests sit on both sides of the boundary; all four mutations on line 7 were killed, each by one of the new tests. M001, M002, O001 and O002 are silent.

mutation/mutations.xml is hand written in the PIT 1.x mutations.xml format (mutation elements with status, sourceFile, mutatedClass, lineNumber and the JUnit 5 unique id in killingTest), because Maven Central is blocked from the build workspace and PIT could not be run. It is minimal and marked for replacement by the maintainer's Maven run; see ../../mutation-PRODUCER.md.
