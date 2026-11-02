# pypa/pip#8366

Replaces inline `assert path in result.files_created` checks in test_uninstall and test_wheel with result.did_create and result.did_not_create helpers defined on the TestPipResult class in tests/lib. Bare asserts disappear from the test files entirely. Honest extraction. Stresses custom assertion detection when the helper lives in another module and the extraAssertions profile is needed.
