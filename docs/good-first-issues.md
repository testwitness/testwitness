# Good first issues (seed list)

Each is one file, one fixture and one docs line. Mentor: the maintainer.

1. Mocha `this.skip()` inside a hook (`beforeEach`) should mark every test in the describe as conditionally skipped.
2. TestNG `@Test(enabled = false)` fixture under `fixtures/java-testng-maven/cases/R003-*` produced with the real TestNG XML.
3. pytest-timeout: `@pytest.mark.timeout(n)` raised, as T001 (needs the T001 rule skeleton in core; small).
4. Playwright `test.describe.configure({ retries: 3 })` as T002.
5. Vitest junit reporter fixture with `describe.each` titles.
6. Kotlin test file detection for JUnit (`*Test.kt`, `src/test/kotlin/**`) using the Java front end as a fallback.
7. Go front end skeleton: `testing` package, `t.Skip`, `t.Run`, `t.Fatal` as an assertion.
8. C# front end skeleton: xUnit `[Fact(Skip = "...")]`, NUnit `[Ignore]`, `Assert.*`.
9. GitLab CI `allow_failure: true` on a test job as W007.
10. Danger output format (`--format danger`) that prints the Markdown with a stable marker for `markdown()`.
