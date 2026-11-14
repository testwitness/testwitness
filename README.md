# testwitness

testwitness reads a pull request's diff and test results and tells the reviewer when tests were deleted, skipped or loosened, or did not run.

![A terminal running git diff on a branch that loosens one assertion, skips one test and deletes another, then testwitness check reporting review with one high finding (A002, assertion loosened) and one medium finding (R003, test skipped), and the deleted test counted in the summary and kept among the low findings, since deleted test findings report at low in v0.1](docs/public/demo.gif)

```bash
npx testwitness check --base origin/main
npx testwitness check --pr https://github.com/<owner>/<repo>/pull/<n>   # trial on a public PR, no clone needed
```

Needs Node 20 or newer and a git checkout with the base branch fetched. Supported on Linux and macOS; Windows is experimental in v0.1 and tracked in [an issue](https://github.com/testwitness/testwitness/issues?q=is%3Aissue+windows+support). For pull requests, use the [GitHub Action](#github-action).

v0.1 reports four rules at medium or high: R003 (test newly skipped), R004 (test turned into an expected failure), R005 (focused test added) and A002 (assertion loosened). Every other rule runs and reports at low until it passes an untuned replay. Two numbers, both on pull requests no rule was tuned on ([how we measure](docs/how-we-measure-precision.md)):

- Noise: on 300 ordinary merged pull requests from 20 repositories testwitness was never tuned on, it reported 3 findings at medium or high, 1.0 per 100 pull requests. All 3 were wrong: two loosened assertions that were exact checks of a new value, and a skip added to a test that already ran nothing. So false findings are rare on ordinary work, but not zero. Measured 14 November 2026 with v0.1 as shipped, judged by two independent judges with a written rubric where a doubtful finding counts as false.
- <!-- recall:start -->Recall: on the weakened pull requests in the held out half of the corpus, which was never used to tune a rule, the four rules report 57 of their 64 true positive labels at medium or high (89%).<!-- recall:end -->

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

By default it blocks on the same four rules and on changes to the gate itself: R003, R004 and R005 at medium and above, A002 only at high. A loosened assertion at medium blocked honest work in our replays, so the hook shows it as advice and the pull request check still reports it. Every other rule, deleted tests included, stays quiet until it passes an untuned replay; a maintainer can opt a rule in and widen the list. What it blocks, the numbers and the limits: [docs/agent-guard.md](docs/agent-guard.md).

## What it reports

Three states, never a verdict about honesty:

- `pass`: no finding at or above the configured threshold (`fail_on`, medium by default, so a finding of any of the four proven rules puts the PR in review).
- `review`: this PR changed what its tests prove. A reviewer should look.
- `unreadable`: the diff rules ran, but no test results were available to confirm what ran.

One PR comment, updated in place, with a four number summary (tests deleted, tests skipped, assertions removed or loosened, changed tests that did not run), a table of findings with file and line, the evidence section, and provenance (agent trailers, shown and never used to change the rules). Findings are also emitted as annotations on the Files tab, which works on fork PRs with a read only token, plus `testwitness.json` and `testwitness.md` in the workspace.

## Rules in v0.1

<!-- rules:start -->
v0.1 reports 4 rules at medium or high, the proven ones. Their numbers on the public PR corpus ([docs/precision.md](docs/precision.md)):

| Rule | Finding | Severity | True positives (corpus) | False positives (medium or high) | Held out precision (medium or high) |
|---|---|---|---|---|---|
| R003 | Test newly skipped or disabled | medium | 64 | 0 | 1.00 |
| R004 | Test converted to expected failure | high | 28 | 0 | 1.00 |
| R005 | Focused test added | high | 15 | 0 | 1.00 |
| A002 | Assertion loosened | medium | 27 | 1 | 0.93 |

Every other rule still runs, but its findings are capped at low (informational, collapsed in the comment) until it passes an untuned replay on pull requests from repositories it was never tuned on ([how we measure](docs/how-we-measure-precision.md)). W006, a change to the gate itself, is the one exception and keeps its severity. A repository can opt a rule back in by naming its severity in `.testwitness.yml`, for example `rules: { R001: medium }`. The severity in brackets is what the rule says before the cap; the corpus counts are judged at that severity:

- R001 Test function deleted (says medium): 32 true positives, 19 false positives on the corpus
- R002 Test file deleted (says high): 12 true positives, 3 false positives on the corpus
- R006 Test body emptied or commented out (says high): no true positive on the corpus yet
- R010 Test added then skipped (says low): 13 true positives, 0 false positives on the corpus
- A001 Assertion removed (says low): 14 true positives, 0 false positives on the corpus
- A009 Tautological assertion (says low): 3 true positives, 0 false positives on the corpus
- O001 New test without an assertion (says low): 5 true positives, 0 false positives on the corpus
- O002 New test with a smoke oracle only (says low): 6 true positives, 0 false positives on the corpus
- O006 New test file with no tests collected (says medium): no true positive on the corpus yet
- E001 Catch all added in a test (says high): 3 true positives, 0 false positives on the corpus
- W002 continue-on-error added to a test step or job (says high): 9 true positives, 2 false positives on the corpus
- W003 Failure suppressed in the run command (says high): 1 true positive, 0 false positives on the corpus
- S004 Snapshot update enabled in the test command (says high): no true positive on the corpus yet
- C001 Test selection narrowed in config (says high): 7 true positives, 0 false positives on the corpus
- C002 Coverage threshold lowered or removed (says medium): 10 true positives, 1 false positive on the corpus
- C003 Passing with no tests enabled (says high): 1 true positive, 2 false positives on the corpus
- V003 Changed test did not run (says high): no true positive on the corpus yet
- V004 Claim in PR text not supported by results (says medium): 9 true positives, 0 false positives on the corpus
- V005 No test results found (says low): no true positive on the corpus yet
- V006 Failures in results while the PR claims passing (says high): no true positive on the corpus yet

The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).
<!-- rules:end -->

## Precision

Measured on a corpus of real public pull requests chosen because a naive detector would flag them (honest refactors) plus a few real weakenings. See [docs/precision.md](docs/precision.md) for the per rule table, regenerated with `pnpm corpus:report`; it judges every rule at the severity the rule gives before the cap, so the rules that are not proven yet stay measured. How the corpus is built and labelled, the held out split and the known limits: [docs/how-we-measure-precision.md](docs/how-we-measure-precision.md). Low findings (moved, parameterised, refactored, conditional) are informational and collapsed in the comment.

## Configuration

Optional `.testwitness.yml` at the repository root, read from the base ref so a PR cannot relax its own check:

```yaml
mode: report          # report | require-ack | strict
fail_on: medium
rules:
  R003: high
  R001: medium        # naming a severity opts a rule that is not proven yet back in
  O006: off
assertions:
  extra: ["assert_ledger_balanced", "com.acme.test.Check#*"]
acknowledge:
  - fingerprint: "R003:src/test/java/com/acme/PaymentsIT.java:PaymentsIT#pollsSettlement"
    reason: "needs a live sandbox, tracked in PAY-412"
    by: sajjad
    date: 2026-11-20
```

## Security and privacy

Runs on `pull_request` with `contents: read`. No secrets, no network calls from the engine, no execution of your code: grammars are bundled, configs are parsed as text. The Action talks only to the GitHub API, for the optional comment and the acknowledgements. Nothing leaves the runner; the JSON report stays in your workspace. See [docs/design.md](docs/design.md).

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
