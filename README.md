# testwitness

Did this PR weaken its tests, and did they actually run?

testwitness is a GitHub Action and a CLI that reads a pull request's diff, the test code (tree-sitter) and the JUnit XML from the test run, and tells the reviewer whether the tests still mean anything: deleted, skipped, loosened, tautological, assertion free, mocked out, swallowed in a catch all, retried, excluded in config, suppressed in CI, or claimed but never run. Java (JUnit 4 and 5, TestNG, AssertJ, Mockito), TypeScript and JavaScript (Jest, Vitest, Mocha, Playwright Test), Python (pytest, unittest). Works on PRs from Claude Code, Codex, Copilot, Cursor, Devin and people. No model, no secrets, no network.

Why it exists: a June 2026 study of 86,156 agent authored test patches found 80.2% had weak or no explicit oracle ([arXiv 2606.18168](https://arxiv.org/abs/2606.18168)), and inaccurate self reporting is the failure mode that grows over time in real sessions ([arXiv 2605.29442](https://arxiv.org/abs/2605.29442)). CI is green either way. testwitness puts the answer on the PR.

## Install

```yaml
# .github/workflows/testwitness.yml
name: testwitness
on:
  pull_request:
permissions:
  contents: read
jobs:
  testwitness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: testwitness/testwitness@v1
        with:
          junit: "**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml"
```

That is the whole install when your test job already writes JUnit XML into the workspace (Surefire and Gradle do by default; pytest needs `--junitxml`, Jest needs jest-junit, Vitest `--reporter=junit`, Playwright the `junit` reporter). Without any XML the diff rules still run and the evidence section reads `unreadable`.

Locally or in any CI:

```bash
npx testwitness check --base origin/main --head HEAD --junit "**/junit*.xml"
```

## What it reports

Three states, never a verdict about honesty:

- `pass`: no finding at or above the configured threshold.
- `review`: this PR changed what its tests prove. A reviewer should look.
- `unreadable`: the diff rules ran, but no test results were available to confirm what ran.

One PR comment, updated in place, with a four number summary (tests deleted, tests skipped, assertions removed or loosened, changed tests that did not run), a table of findings with file and line, the evidence section, and provenance (agent trailers, shown and never used to change the rules). Findings are also emitted as annotations on the Files tab, which works on fork PRs with a read only token, plus `testwitness.json` and `testwitness.md` in the workspace.

## Rules in v0.1

<!-- rules:start -->
Rules with measured true positives on the public PR corpus (see [docs/precision.md](docs/precision.md)):

| Rule | Finding | Default | True positives | False positives (medium or high) | Precision |
|---|---|---|---|---|---|
| R003 | Test newly skipped or disabled | medium | 4 | 0 | 1.00 |

19 more rules ship in v0.1 but have no true positive in the corpus yet, so no precision number is claimed for them: R001 Test function deleted; R002 Test file deleted; R004 Test converted to expected failure; R005 Focused test added; R006 Test body emptied or commented out; R010 Test added then skipped; A001 Assertion removed; A002 Assertion loosened; A009 Tautological assertion; O001 New test without an assertion; O002 New test with a smoke oracle only; O006 New test file with no tests collected; E001 Catch all added in a test; W003 Failure suppressed in the run command; S004 Snapshot update enabled in the test command; V003 Changed test did not run; V004 Claim in PR text not supported by results; V005 No test results found; V006 Failures in results while the PR claims passing. The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).
<!-- rules:end -->

## Precision

Measured on a corpus of real public pull requests chosen because a naive detector would flag them (honest refactors) plus a few real weakenings. See [docs/precision.md](docs/precision.md) for the per rule table, regenerated with `pnpm corpus:report`. Low findings (moved, parameterised, refactored, conditional) are informational and collapsed in the comment.

## Configuration

Optional `.testwitness.yml` at the repository root, read from the base ref so a PR cannot relax its own check:

```yaml
mode: report          # report | require-ack | strict
fail_on: high
rules:
  R003: high
  T001: off
assertions:
  extra: ["assert_ledger_balanced", "com.acme.test.Check#*"]
acknowledge:
  - fingerprint: "R003:src/test/java/com/acme/PaymentsIT.java:PaymentsIT#pollsSettlement"
    reason: "needs a live sandbox, tracked in PAY-412"
    by: sajjad
    date: 2026-11-20
```

## Security and privacy

Runs on `pull_request` with `contents: read`. No secrets, no network calls, no execution of your code: grammars are bundled, configs are parsed as text. Nothing leaves the runner; the JSON report stays in your workspace. See [docs/design.md](docs/design.md).

## Development

```bash
pnpm install
pnpm check          # typecheck, lint, unit tests
pnpm fixtures       # golden fixture cases per language and framework
pnpm corpus:report  # precision on the public PR corpus
```

Layout: `packages/core` (engine and rules), `packages/lang-*` (tree-sitter front ends and `.scm` queries), `packages/junit` (streaming XML reader), `packages/cli`, `packages/action`, `fixtures/` (real projects with real JUnit XML and golden cases), `corpus/` (public PR patches with hand labels).

## Licence

Apache 2.0.
