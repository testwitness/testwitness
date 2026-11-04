# Design

This page explains the decisions behind testwitness and what is deliberately out of scope. The rule catalogue is in the rules reference; the measured precision is in [precision.md](./precision.md).

## The question the tool answers

A reviewer looking at a pull request wants to know two things about its tests: do they still prove anything, and did they run. CI answers neither. A green check means the tests that ran passed; it says nothing about tests that were deleted, skipped, loosened, mocked out or never collected, and nothing about a PR description that says "all tests pass" when no test ran. testwitness reads three inputs the PR already has, the git diff, the test source and the JUnit XML, and puts the answer on the PR.

## Three states, not two

The check reports `pass`, `review` or `unreadable`. It never says a PR lied.

The reason is empirical. In the one published audit of "tests pass" claims against transcripts, 117 of 124 claims had a run behind them, and the 7 without one were unreadable output rather than lies. pr-witness's author reports that on a frozen batch of 17 real commits its accusing verdict was wrong every time while its "review" verdict was right every time. A tool that accuses honest work is turned off within a week. So the strongest statement testwitness makes is "this PR changed what its tests prove, a reviewer should look", and a claim that cannot be checked is reported as unreadable, with the reporter to turn on, not as false.

## Diff scoped

Rules run on what the PR changed, never on the whole repository. A repository with two hundred pre existing skipped tests gets no finding until a PR adds one. This is the single largest false positive control and the main difference from Sonar, tsDetect and the eslint jest rules, which lint the whole tree and know nothing about the base, the head or the test run.

## Deterministic, no model

Every finding comes from a rule that can be read, tested and argued with: a tree-sitter query, a diff pattern or a comparison of two inventories. There is no model call. Cheap detectors beat model judges on this task in the published comparison (five model judges never exceeded AUROC 0.65 while TF-IDF detectors reached 0.83 and 0.95), they cost nothing per run, they work offline, and they can be explained in a code review. Each finding carries the rule id, the file and line, the before and after text and a one line reason.

## Precision over recall

A rule ships only when its false positive rate on the corpus is acceptable, and every rule's false positive controls are written before its detector. Concretely, R001 (test deleted) stays low when the test was moved (same body or same name elsewhere in the PR), folded into a parameterised test, rewritten (other changed test files gained as many tests as the PR deleted), replaced in its own class or group, or refactored (every assertion survives). A deletion is medium or high only when none of those signals is present. The same discipline applies to A001 (consolidation, assertions moved to a sibling, parameterised, replaced by call) and A002 (a stronger assertion on a sub expression). The replaced by call control exists because a helper is often defined in a file the PR does not touch, or that is not on disk at all, so the inventory cannot see that `result.did_create(path)` asserts. Each front end records every call in a test body and marks the ones that are a whole statement. When a changed test lost assertions and gained at least as many new call statements, A001 drops one step (medium to low, high to medium) and labels the finding replaced by call, naming the first new callee. A call statement is new when its callee name is called nowhere in the base body, it is not on the line of an assertion, and it is not a print, log or sleep call (`print`, `console.*`, `logging.*`, `logger.*`, `System.out.*`, `Thread.sleep` and the like). The finding stays visible in the collapsed low list because the helper may not assert at all. Severity defaults keep anything context dependent at medium or low, so a single uncertain rule cannot drive the check to review on its own.

The corpus (`corpus/`) holds patches from real public pull requests under permissive licences, most of them honest refactors chosen because a naive detector would flag them. It is split by hash of the URL into a tuning half and a held out half; precision is published on the held out half. Every user reported false positive becomes a corpus entry before the fix merges.

## JUnit XML is the contract

The evidence join (V003, V004, V006) reads JUnit XML because every runner in the three languages can write it: Surefire and Gradle do by default, pytest with `--junitxml`, Jest with jest-junit, Vitest and Playwright with their junit reporters, Mocha with mocha-junit-reporter. JUnit XML is not one standard; the reader relies only on the elements and attributes all producers agree on (`testsuite/@name`, `testcase/@name`, `@classname`, `@file`, and the child elements `skipped`, `failure`, `error`, `flakyFailure`, `flakyError`, `rerunFailure`, `rerunError`) and carries a fixture produced by running each real producer (`fixtures/*/junit/`). Name normalisation strips parametrisation suffixes and understands each producer's `classname` shape. What is lost by this choice: per assertion detail that framework specific hooks could give. What is gained: three languages and seven runners through one parser, and a tool that works on any CI.

## Why the AST and why tree-sitter

Diff text alone cannot tell a deleted test from a moved one, a loosened assertion from a reformatted one, or a test from a helper. The engine parses the base and head versions of every changed test file into a `TestInventory` (tests, containers, markers, assertions with a strength rank, mocks, body hash, statement count) and the rules compare inventories. tree-sitter gives one parser architecture for Java, TypeScript, JavaScript and Python as wasm grammars loaded by `web-tree-sitter`, no native compile on the runner, and queries in `.scm` files that a contributor can extend without touching the engine. Framework knowledge lives in tables (test call names, skip and focus modifiers, assertion shapes, the strength lattice, mock shapes), not in code.

## Security posture

The Action runs on `pull_request` with `permissions: contents: read`. It needs no secrets and makes no network calls: grammars and parsers are bundled. It never executes repository code: no install, no test run, no `require` of config files; runner configs are parsed as text or AST and only literal values are read. Configuration is read from the base ref in PR mode, so a PR cannot relax its own check (W006 reports any attempt). PR text is data: never interpolated into a shell, never passed as a workflow command, escaped in the comment. Fork PRs get annotations and a job summary from the read only run; the optional comment stage reads a JSON artifact validated against the schema and renders it with a fixed template.

## What is deliberately out of scope for v0.1

Running the base branch's tests against the head (pr-witness and truedone do this; it doubles CI time and belongs behind a flag), mutation testing on changed lines (v0.3, by wrapping Stryker, PIT and mutmut), any model judge, any hosted service, and any attempt to infer intent. Provenance (Claude Code, Cursor, Copilot, Codex and Devin markers) is detected and shown and never changes which rules run, because a tool that cannot see intent should not treat authors differently.
