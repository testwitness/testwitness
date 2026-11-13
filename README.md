# testwitness

testwitness reads a pull request's diff and test results and tells the reviewer when tests were deleted, skipped or loosened, or did not run.

![A terminal running git diff on a branch that loosens one assertion, skips one test and deletes another, then testwitness check reporting review with one high finding (A002, assertion loosened) and two medium findings (R001, test deleted; R003, test skipped)](docs/public/demo.gif)

```bash
npx testwitness check --base origin/main
npx testwitness check --pr https://github.com/<owner>/<repo>/pull/<n>   # trial on a public PR, no clone needed
```

Needs Node 20 or newer and a git checkout with the base branch fetched. Supported on Linux and macOS; Windows is experimental in v0.1 and tracked in [an issue](https://github.com/testwitness/testwitness/issues?q=is%3Aissue+windows+support). For pull requests, use the [GitHub Action](#github-action).

Measured on 347 public pull requests ([how we measure](docs/how-we-measure-precision.md)):

- R003 (test newly skipped), R004 (test converted to expected failure) and R005 (focused test added): 64, 28 and 15 true positives, 0 false positives on medium or high.
- A002 (assertion loosened): 27 true positives, 1 false positive, held out precision 0.93 on medium or high.
- As a Claude Code hook with default settings, it blocks 0 of the 217 pull requests that have no true positive finding.

## What it checks

testwitness is a GitHub Action and a CLI that reads a pull request's diff, the test code (tree-sitter) and the test results from the run (JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright), and tells the reviewer whether the tests still mean anything: deleted, skipped, loosened, tautological, assertion free, swallowed in a catch all, excluded in config, suppressed in CI, or claimed but never run. Java (JUnit 4 and 5, TestNG, AssertJ, Mockito), TypeScript and JavaScript (Jest, Vitest, Mocha, Playwright Test), Python (pytest, unittest). Works on PRs from Claude Code, Codex, Copilot, Cursor, Devin and people. No model, no secrets, no network (the `--pr` trial alone fetches the pull request with git).

Why it exists: a June 2026 study of 86,156 agent authored test patches found 80.2% had weak or no explicit oracle ([arXiv 2606.18168](https://arxiv.org/abs/2606.18168)), and inaccurate self reporting is the failure mode that grows over time in real sessions ([arXiv 2605.29442](https://arxiv.org/abs/2605.29442)). CI is green either way. testwitness puts the answer on the PR.

## GitHub Action

<details>
<summary>Workflow file</summary>

```yaml
# .github/workflows/testwitness.yml
name: testwitness
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write # to post the comment; without it findings still show as annotations
jobs:
  testwitness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: testwitness/testwitness@v0
        with:
          results: "**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml"
```

</details>

That is the whole install when your test job already writes JUnit XML into the workspace (Surefire and Gradle do by default; pytest needs `--junitxml`, Jest needs jest-junit, Vitest `--reporter=junit`, Playwright the `junit` reporter). JUnit XML is the first recommendation. When a runner only gives you TAP (`node --test --test-reporter=tap`) or a JSON report (`jest --json`, `vitest --reporter=json`, `pytest --json-report`, Playwright `--reporter=json`), point `results` at that file instead; the format is told from the content ([evidence](docs/evidence.md)). `results` used to be called `junit`, and `junit` still works. Without any results the diff rules still run and the evidence section reads `unreadable`.

The CLI ships as one npm package with no runtime dependencies and runs the same engine locally or in any CI:

```bash
npx testwitness check --base origin/main --head HEAD --results "**/junit*.xml"
# or install it once
npm i -g testwitness
testwitness check --base origin/main --results "**/junit*.xml"
```

See [docs/cli.md](docs/cli.md) for every option.

## Inside the agent's loop

The same engine can run before the pull request exists, as a hook in Claude Code, Cursor or Codex, or as a git pre-push hook. When the agent tries to commit, push or end its turn with weakened tests in the working tree, the hook blocks and hands back the rule, the file, the line and the base text to restore. It blocks the same finding at most twice per session, and a crash or a timeout lets the action through.

```bash
npm i -g testwitness
testwitness init --agent claude    # or cursor, codex, git
```

In Claude Code you can install it as a plugin instead, with the hook and the read only MCP server bundled (the package must be installed as above): `/plugin marketplace add testwitness/testwitness`, then `/plugin install testwitness@testwitness`.

By default it blocks on a small proven set of rules (loosened assertions at high, expected failure markers, focused tests, tests or coverage thresholds cut in config, failures ignored in CI, and changes to the gate itself): the ones with true positives and no wrongful block on our corpus and on 300 real merged pull requests. Every other rule, deleted tests included, is advice until the replay proves it; a maintainer can widen the list. What it blocks, the numbers and the limits: [docs/agent-guard.md](docs/agent-guard.md).

## What it reports

Three states, never a verdict about honesty:

- `pass`: no finding at or above the configured threshold.
- `review`: this PR changed what its tests prove. A reviewer should look.
- `unreadable`: the diff rules ran, but no test results were available to confirm what ran.

One PR comment, updated in place, with a four number summary (tests deleted, tests skipped, assertions removed or loosened, changed tests that did not run), a table of findings with file and line, the evidence section, and provenance (agent trailers, shown and never used to change the rules). Findings are also emitted as annotations on the Files tab, which works on fork PRs with a read only token, plus `testwitness.json` and `testwitness.md` in the workspace.

## Rules in v0.1

<!-- rules:start -->
A rule shows a precision number only when the engine confirmed at least 10 true positives for it on the public PR corpus and its precision on medium and high findings on the held out half is at least 0.9 (see [docs/precision.md](docs/precision.md)).

| Rule | Finding | Default | True positives | False positives (medium or high) | Precision | Held out precision (medium or high) |
|---|---|---|---|---|---|---|
| R003 | Test newly skipped or disabled | medium | 64 | 0 | 1.00 | 1.00 |
| R004 | Test converted to expected failure | high | 28 | 0 | 1.00 | 1.00 |
| R005 | Focused test added | high | 15 | 0 | 1.00 | 1.00 |
| A002 | Assertion loosened | medium | 27 | 1 | 0.96 | 0.93 |
| C002 | Coverage threshold lowered or removed | medium | 10 | 1 | 0.91 | 1.00 |

Measured, not yet promoted (no headline number):

- R001 Test function deleted: 32 true positives, 23 false positives, held out precision 0.77
- R002 Test file deleted: 12 true positives, 3 false positives, held out precision 0.75
- R010 Test added then skipped: 13 true positives, 0 false positives, held out precision n/a
- A001 Assertion removed: 14 true positives, 0 false positives, held out precision n/a
- A009 Tautological assertion: 3 true positives, 0 false positives, held out precision n/a
- O001 New test without an assertion: 5 true positives, 0 false positives, held out precision n/a
- O002 New test with a smoke oracle only: 9 true positives, 5 false positives, held out precision n/a
- E001 Catch all added in a test: 3 true positives, 0 false positives, held out precision 1.00
- W002 continue-on-error added to a test step or job: 9 true positives, 2 false positives, held out precision 0.67
- W003 Failure suppressed in the run command: 1 true positive, 0 false positives, held out precision 1.00
- C001 Test selection narrowed in config: 7 true positives, 0 false positives, held out precision n/a
- C003 Passing with no tests enabled: 1 true positive, 2 false positives, held out precision 0.50
- V004 Claim in PR text not supported by results: 9 true positives, 0 false positives, held out precision 1.00

10 more rules ship in v0.1 but have no true positive in the corpus yet, so no precision number is claimed for them: R006 Test body emptied or commented out; O006 New test file with no tests collected; M001 Changed lines with surviving mutants; M002 New test kills nothing; W006 The integrity gate itself weakened; S004 Snapshot update enabled in the test command; V003 Changed test did not run; V005 No test results found; V006 Failures in results while the PR claims passing; V008 Changed production lines not executed. The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).
<!-- rules:end -->

## Precision

Measured on a corpus of real public pull requests chosen because a naive detector would flag them (honest refactors) plus a few real weakenings. See [docs/precision.md](docs/precision.md) for the per rule table, regenerated with `pnpm corpus:report`. How the corpus is built and labelled, the held out split and the known limits: [docs/how-we-measure-precision.md](docs/how-we-measure-precision.md). Low findings (moved, parameterised, refactored, conditional) are informational and collapsed in the comment.

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

Runs on `pull_request` with `contents: read`. No secrets, no network calls from the engine, no execution of your code: grammars are bundled, configs are parsed as text. The Action talks only to the GitHub API, for the optional comment and the optional [run history](docs/history.md) artifact. Nothing leaves the runner; the JSON report stays in your workspace. See [docs/design.md](docs/design.md). The one place your code runs is the optional [mutation on request](docs/mutation-on-request.md) workflow, which you add yourself and which starts only on a maintainer's `/testwitness mutate` comment; testwitness then only reads the Stryker or PIT report it wrote.

## Development

```bash
pnpm install
pnpm check          # typecheck, lint, unit tests
pnpm fixtures       # golden fixture cases per language and framework
pnpm corpus:report  # precision on the public PR corpus
```

Layout: `packages/core` (engine and rules), `packages/lang-*` (tree-sitter front ends and `.scm` queries), `packages/junit` (test results readers: streaming JUnit XML and TAP, JSON reporters), `packages/cli`, `packages/action`, `fixtures/` (real projects with real JUnit XML, TAP and JSON results and golden cases), `corpus/` (public PR patches with hand labels).

## Licence

Apache 2.0.
