# Roadmap

What is planned, in order, and what is deliberately not planned. Dates are targets, not promises.
Open an issue if something here matters to you, or if something missing does.

## Principles that do not change

- No model inside the tool. Every finding comes from a deterministic rule you can read.
- The engine makes no network calls. The Action only talks to the GitHub API with the workflow token.
- testwitness never executes the code of the repository it checks, unless a maintainer opts in to the
  mutation job, which runs in its own workflow and is triggered by a maintainer comment.
- Precision over recall. A rule is promoted in the README only when its precision on medium and high
  findings, measured on the held out half of the corpus, is above 0.9.

## Now: v0.1

- 28 rules across Java (JUnit 4 and 5, TestNG), TypeScript and JavaScript (Jest, Vitest, Mocha,
  Playwright, Node's test runner) and Python (pytest, unittest).
- Test results from JUnit XML, TAP, Jest and Vitest JSON, pytest json-report and Playwright JSON.
- PR comment, annotations, job summary, JSON report with a published schema, MCP server for coding
  agents, run history, coverage and mutation report reading.
- Release on npm (`npx testwitness check`) and the GitHub Marketplace.

## Next: v0.2 (about one month after v0.1)

- Precision first: corpus of at least 300 real public PRs, at least 10 confirmed true positives for every
  rule that shows a precision number, CRLF and Windows parity proven by fixtures.
- The first minute: time from installing the Action to the first useful finding under two minutes on a
  real repository, measured and published.
- Whatever the evidence from users and from the public complaints about coding agents and tests says
  matters most (see the study and the issues labelled `user-request`).
- Benchmarks on 100, 1,000 and 5,000 file PRs enforced in CI on Linux, Windows and macOS.

## Later

- Kotlin and Go front ends, then C# with TRX results.
- GitLab CI output and GitLab CI configuration rules.
- One click repair: a GitHub suggested change that restores a deleted or loosened assertion from the
  base commit.

## Not planned

- A model that judges whether a test is good. It would make findings unexplainable and irreproducible.
- Running the PR's tests ourselves by default. Your CI already does that; testwitness reads its results.
- A hosted service or dashboard. Everything runs in your CI or on your machine.
