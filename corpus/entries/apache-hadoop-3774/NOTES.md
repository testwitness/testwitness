# apache/hadoop#3774

Renames the property that feeds testFailureIgnore from ignoreTestFailure to the standard maven.test.failure.ignore and removes per module references; the default stays true as before. No change in behaviour. Honest control for W003.
