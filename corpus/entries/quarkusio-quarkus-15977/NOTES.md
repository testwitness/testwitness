# quarkusio/quarkus#15977

Comments out the assertThat on an environment variable value in an OpenShift S2I resource test, with a note that it is flaky. The rest of the test's assertions stay. Weakened. Stresses A001 on an assertion removed by commenting it out inside a lambda.
