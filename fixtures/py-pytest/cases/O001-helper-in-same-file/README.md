The new test delegates its check to _assert_balanced, a helper in the same file whose body asserts. Helpers are counted one level deep, so the test has an assertion and O001 is quiet.
