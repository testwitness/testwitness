Negative. A new test is added with test.skipIf(process.env.CI). A conditional skip is not a skip marker, so the test counts as a running test and R010 stays quiet.
