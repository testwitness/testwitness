# apache/beam#6645

Adds unittest.skipIf on Python 3 (unless an environment variable asks to run them) to six flaky runner tests, with a tracking ticket in the reason. The skip is conditional on the interpreter version and points at an issue, which the spec grades low as conditional. Labelled as the expected low signal.
