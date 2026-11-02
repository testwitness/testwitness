# pytest-dev/pytest#14293

Removes the deprecated importorskip ImportError capture; tests for the deprecation warning are deleted and replaced by tests for the new behaviour, with pytest.warns assertions gone. Honest deletion with the feature. Stresses removal and assertion rules when the replaced tests have different names.
