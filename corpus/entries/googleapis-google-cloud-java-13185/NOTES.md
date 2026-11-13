# googleapis/google-cloud-java#13185

Wraps backup schedule deletion in the finally blocks of several Spanner sample integration tests in try/catch that prints the error, so a cleanup failure cannot mask the test's own failure. The tested calls are outside the catch. Honest control for E001 on a cleanup catch.
