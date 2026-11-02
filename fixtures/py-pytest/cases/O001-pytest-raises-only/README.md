A new test's only check is a with pytest.raises(ValueError) block. An exception expectation is an oracle, so O001 must not fire even though there is no bare assert.
