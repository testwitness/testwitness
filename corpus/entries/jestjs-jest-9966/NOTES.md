# jestjs/jest#9966

Calls skipSuiteOnWindows() at the top of an e2e test file with a comment linking the Node issue that breaks it. The skip is a helper call, not a marker, and the reason is in a comment. Honest conditional skip. Stresses skip rules on helper calls and reason detection from adjacent comments.
