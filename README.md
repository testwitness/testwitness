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

| Rule | Finding | Default |
|---|---|---|
| R001 | Test function deleted | medium, high when its production code changed |
| R002 | Test file deleted | high |
| R003 | Test newly skipped or disabled | medium, high when its production code changed |
| R004 | Test converted to expected failure | high |
| R005 | Focused test added (.only, fit) | high |
| R006 | Test body emptied | high |
| R010 | Test added already skipped | low |
| A001 | Assertion removed | medium, high when it touched changed production code |
| A002 | Assertion loosened (equality to not null, exact to contains, called with to called) | medium, high for two steps or truthiness |
| A009 | Tautological assertion | high |
| O001 | New test without an assertion | high |
| O002 | New test with a smoke oracle only | low |
| O006 | New test file with no tests collected | medium |
| E001 | Catch all added in a test | high |
| S004 | Snapshot update enabled in the test command | high |
| W003 | Failure suppressed in the run command (`\|\| true`, `-DskipTests`, `set +e`) | high |
| V003 | Changed test did not run (not in the JUnit XML) | high |
| V004 | Claim in PR text not supported by results | medium |
| V005 | No test results found | low |
| V006 | Failures in results while the PR claims passing | high |

Every rule has documented false positive controls and ships with golden fixtures: renamed and moved tests, parameterised folds, helper extraction, consolidated assertions, tracked skips with an issue reference, platform conditional skips, deleted features, smoke tests. Diff scoped: a repository full of pre existing skipped tests gets no finding until a PR adds one.

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
