# getsentry/sentry-python#7444

Replaces a random integer with a uuid in the Django cache LOCATION of two test settings so parallel workers never share a cache. No assertion changes. Honest flaky fix.
