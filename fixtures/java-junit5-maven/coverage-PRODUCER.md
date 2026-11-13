# JaCoCo coverage for the V008 cases

The two jacoco.xml files under cases/V008-jacoco-*/coverage/ were written by
hand in the JaCoCo 0.8 report format on 4 Nov 2026 because Maven Central is
blocked from the build workspace. They are to be replaced by real output.

To produce it on a machine with Maven Central access, from project/:

    mvn -B test -Dmaven.test.failure.ignore=true

The pom now runs jacoco-maven-plugin 0.8.12 (prepare-agent, then report at the
test phase), which writes target/site/jacoco/jacoco.xml. Copy that file over
each hand written jacoco.xml, adjust the two cases' expected.json only if the
real line numbers differ from the hand written ones, and delete this note.
