# prestodb/presto#28724

Removes one assertQuery call from testTimestampWithTimeZone. assertQuery is a project assertion helper, not a framework assertion. Stresses A001 with a custom assertion helper that must be configured or inferred.
