# Roadmap

What is planned, in order, and what is deliberately not planned. Dates are targets, not promises.
Open an issue if something here matters to you, or if something missing does.

## Principles that do not change

- No model inside the tool. Every finding comes from a deterministic rule you can read.
- The engine makes no network calls. The Action only talks to the GitHub API with the workflow token.
- testwitness never executes the code of the repository it checks.
- Precision over recall. A rule reports at medium or high only after it passes an untuned replay: ordinary
  merged pull requests from repositories it was never tuned on, every medium and high finding judged by
  hand. Until then it runs and its findings are capped at low.

## Now: v0.1

- Four proven rules at medium or high: R003 (test newly skipped), R004 (test turned into an expected
  failure), R005 (focused test added) and A002 (assertion loosened). The agent hook blocks on the same
  four, plus W006 (a change to the gate itself).
- 20 more rules that run and report at low until each passes an untuned replay. A repository can opt
  one back in with a severity in `.testwitness.yml`.
- Java (JUnit 4 and 5, TestNG), TypeScript and JavaScript (Jest, Vitest, Mocha, Playwright, Node's test
  runner) and Python (pytest, unittest).
- Test results from JUnit XML, TAP, Jest and Vitest JSON, pytest json-report and Playwright JSON.
- PR comment, annotations, job summary, JSON report with a published schema, MCP server for coding
  agents, agent hooks.
- Release on npm (`npx testwitness check`) and the GitHub Marketplace.

Cut from v0.1 and kept on the `experimental` branch: run history, coverage on changed lines (V008) and
mutation on request (M001, M002). They come back only with a measurement that shows they help.

## Earning a way back, one rule at a time

Each rule below goes back to medium or high only after an untuned replay on pull requests from
repositories it has never been tuned on shows its findings at medium or high are right. A replay that
was used to fix a rule does not count for that rule again; the next replay needs new repositories.

1. R001 (test function deleted) first. Deleted tests are what people complain about most, and R001 has
   the most true positives in the corpus. Its false positives (moved, rewritten or replaced tests) are
   what the replay has to show are gone.
2. Then the others, one at a time, each gated on its own untuned replay: R002, A001, E001, the C and W
   rules, V003 and V006 (with test results), the O rules, and the rest.

## Next: v0.2 (about one month after v0.1)

- Precision first: R001's untuned replay, then the next rule's, as above. CRLF and Windows parity proven
  by fixtures.
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
