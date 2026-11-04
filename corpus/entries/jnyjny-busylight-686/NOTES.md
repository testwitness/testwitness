# JnyJny/busylight#686

Adds continue-on-error: ${{ matrix.python-version == '3.14' }} to the test job of the release workflow, whose only real step runs pytest. Test failures on Python 3.14 no longer fail the workflow or block publish. Stresses W002 when the value is an expression that is true for some matrix rows rather than a literal true; the engine only matches the literal today.
