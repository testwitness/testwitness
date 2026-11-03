# GitHub Marketplace listing (draft, Sajjad publishes)

Name: testwitness
Categories: Code quality (primary), Testing (secondary)
Icon: eye. Colour: gray-dark.

One line: Did this PR weaken its tests, and did they actually run?

Description:

testwitness reads a pull request's diff, the test code and the JUnit XML from the test run and tells the reviewer whether the tests still prove anything. It reports deleted, skipped, loosened, tautological and assertion free tests, catch alls that swallow failures, snapshot updates forced in the test command, suppressed test commands, tests that changed but never ran, and PR descriptions that claim passing tests the results do not show.

Java (JUnit 4 and 5, TestNG, AssertJ, Mockito), TypeScript and JavaScript (Jest, Vitest, Mocha, Playwright Test), Python (pytest, unittest). Works on PRs from Claude Code, Codex, Copilot, Cursor, Devin and people.

No model, no secrets, no network, never runs your code. One YAML block to install, `contents: read` is enough. Three states, pass, review or unreadable, never a verdict about honesty. Every finding carries the rule, the file and line, the before and after, and a one line reason, and can be acknowledged with a reason that stays in the report.

Precision is measured on real public pull requests and published per rule.
