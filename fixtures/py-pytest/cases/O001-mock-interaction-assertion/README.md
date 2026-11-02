The new test's only oracle is audit.record.assert_called_once_with(...). Mock call assertions are interaction assertions, so the test has an oracle and O001 does not fire.
