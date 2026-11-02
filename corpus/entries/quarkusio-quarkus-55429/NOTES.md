# quarkusio/quarkus#55429

Adds a class level @Disabled("This test is flaky. This needs to be examined") to AccessLogTestCase, disabling every test in the class. Weakened. Stresses class level marker propagation to each test.
