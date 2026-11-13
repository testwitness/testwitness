# PIT mutation reports for the M and O cases

The mutations.xml files under cases/M00*-pit-*/mutation/ and
cases/O001-pit-*/mutation/ were written by hand in the PIT 1.x mutations.xml
format on 4 Nov 2026, because Maven Central is blocked from the build workspace
and PIT could not be run. They are minimal: only the mutations the rules need,
with the JUnit 5 unique id that pitest-junit5-plugin writes in killingTest. They
are to be replaced by real output.

To produce it on a machine with Maven Central access, copy a case's head tree
over project/src (keep project/pom.xml), then from project/:

    mvn -B test-compile org.pitest:pitest-maven:mutationCoverage \
      -DtargetClasses=demo.Shipping -DtargetTests=demo.ShippingTest \
      -DoutputFormats=XML -DtimestampedReports=false

with the class and test of that case (Shipping, Money, Age, Tax, Qty). The pom
now declares pitest-maven 1.16.1 with pitest-junit5-plugin 1.2.1 and is not bound
to a phase, so `mvn test` is unchanged. PIT writes
target/pit-reports/mutations.xml. Copy it over the case's hand written file,
adjust the case's expected.json only if the real mutations differ, and delete
this note when all five are replaced. A run with -DfullMutationMatrix=true (what
`testwitness mutate-plan` prints) adds killingTests and succeedingTests
elements; the reader understands both forms.
