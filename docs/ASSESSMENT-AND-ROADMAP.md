# testwitness: honest assessment, gaps, and how it gets really intelligent

Written 4 Nov 2026, day 4, after the corpus reached 134 real public PRs.
Numbers in this document come from docs/precision.md and LOG.md as of that
date. Nothing here is a promise to users; it is the working view of the lead
engineer for Sajjad.

## 1. Where it stands

A credible v0.1 worth launching, with a clear path to great. It should not be
described as more than that in public.

What is strong

- The problem is real and growing. Agent PRs that keep CI green by weakening
  tests is something every team merging them will hit, and nobody has a
  deterministic, measurable check for it.
- The evidence join (did the changed test actually run) is the part nobody
  else does. Most test quality tools look at the diff only.
- The engineering discipline is above the norm for a v0.1: real runner XML in
  the fixtures, a 134 PR corpus of real public changes, published precision per
  rule, mutation testing on the engine, no model inside and no network.

What is weak

- Several rules still have thin or no public evidence. A002 has 3 engine
  confirmed positives, A009 2, E001 1, W003 1, and R006, O006 and S004 have
  none after a full day of searching public PRs at 100 stars and up. The
  catalogue is bigger than what is proven.
- A002 (assertion loosened) misses 21 of 24 real cases in the corpus because it
  only pairs assertions whose subject is the identical expression. The
  loosening patterns people actually use (equals to contains, equals to greater
  than, length to non empty, exact to regex) are exactly what it misses. This is
  the biggest gap.
- O001 (new test without an assertion) sits at 0.50 precision: half of the
  assertion free tests in public PRs are intentional smoke tests (race tests,
  verbose output tests, does not throw tests). Static rules alone cannot tell
  those apart.
- R001 (test deleted) is at 0.65 because large rewrites across files (kafka,
  scikit-learn, pandas fixture folds) look like deletions from inside one file.
- Nobody has used it yet. Great is decided by whether maintainers keep it
  installed after the first month, and there is no data on that.

What would make it great, in order

1. A002 pairing by subject expression rather than exact string, with a strength
   lattice per matcher family, so the common loosenings are caught.
2. The 500 plus 150 PR study published with real numbers. That is what makes
   people care.
3. Three months of real installs with every false positive report folded into
   the corpus before the fix merges.

## 2. Decision for Sajjad: the 7 unmeasured rules

Decided 4 Nov 2026 at 04:17: Option A. All 22 rules enabled, the README keeps the measured and unmeasured split. O001 ships at low by default until mutation on request exists. A002 semantic pairing happens before the public launch and is measured on the corpus before merge. After A002: the JSON schema and MCP server, then the rest of section 5 in order. Before Show HN, a quiet week: install on 3 to 5 friendly public repositories (Sajjad asks the maintainers) and fold every false positive report into the corpus.

Seven rules ship in v0.1 with no true positive in the corpus: R006 test body
emptied, O006 test file with no tests collected, W006 integrity gate weakened,
S004 snapshot update forced in the test command, V003 changed test did not run,
V005 no results found, V006 failures while the PR claims passing. V003, V005 and
V006 cannot have corpus positives at all, because public PRs do not carry their
JUnit XML; they are proven by 72 golden cases on real runner output instead.

Option A (recommended): ship all 22 rules enabled. The README shows the 15
measured rules with their numbers and names the 7 unmeasured ones as
unmeasured, which it already does. Reason: the golden fixtures prove each rule
fires on the shape it was written for and stays quiet on the documented
controls; the first real users are the fastest way to get the missing
positives; and V003 to V006 are the point of the tool.

Option B: ship the 7 disabled by default (`rules: { R006: off }` style in the
default config), enabled by one line. Cleaner claim, less value on day one, and
users rarely turn optional rules on.

Either way, no precision number is claimed for a rule without corpus
positives, and the study does not report per rule precision for them.

## 3. Gaps, concrete

Engine recall gaps found by the corpus (all documented in corpus NOTES):

- A002 pairing: subject moves into a boolean (assertTrue(h.contains(x)),
  values.includes(x)), subject gains .length or loses .trim(), len(x) == n
  becomes membership, all(...) generators.
- Project matcher chains are not assertions: Hamcrest equalTo to greaterThan
  inside a custom matcher, PyHamcrest has_items to has_item(contains_string),
  Chai lengthOf to length greaterThan.
- QUnit is not parsed. Python files named *_test_it.py are not matched.
- W002 matches only a literal true, not an expression such as

  ```yaml
  continue-on-error: ${{ matrix.x == 'y' }}
  ```
- W003 does not read shell scripts or appveyor.yml, where suppressions actually
  live in older repositories.
- R003 misses an in body `self.skipTest(...)`. R001 misses tests declared
  through a project wrapper (`integTest(...)`).
- Assertion helpers in another module still need a line of config when they do
  not follow a naming convention and are not replaced one for one.

Evidence gaps:

- JUnit XML only. TAP, the Jest and Vitest JSON reporters, pytest-json-report,
  Playwright JSON, Go test JSON and .NET TRX are not read.
- No coverage input, so "changed production line never executed" is not a
  finding yet.
- No memory across runs, so a skip added to a test that failed in the last
  three runs looks the same as any other skip.

Product gaps:

- Fork PRs get annotations and a job summary but no sticky comment, because the
  read only token cannot write; a two stage workflow (results as an artifact,
  comment from a trusted job) is designed but not shipped.
- No GitLab or Bitbucket output. No way for an agent to read the findings
  before a human does.

## 4. How it becomes really intelligent and dynamic (without a model inside)

The hard gate stays: deterministic rules, no network, never executes the
scanned repository's code. Intelligence comes from more evidence and better
joins, not from guessing.

### 4.1 Semantic assertion understanding (A002 rewrite)

Pair assertions by a normalised subject expression: strip accessors that do not
change identity (.length, .size(), .trim(), str()), unwrap boolean wrappers
(contains, includes, in, startsWith, matches) back to the subject they wrap,
and treat matcher chains (AssertJ, Hamcrest, PyHamcrest, Chai, Jest asymmetric
matchers) as assertions with a strength rank. Then compare strength on a per
family lattice: exact equality at the top, ordered containment, unordered
containment, bound, non null, truthiness, existence. A pair whose strength
drops is a loosening; a pair whose subject narrows (whole body to one field) is
a narrowing. Expected result on the corpus: most of the 21 misses become
findings with no new false positives, measured before merge.

### 4.2 Whole repository helper resolution

Index the test support modules of the checkout once per run (tests/lib,
conftest.py, test utils, base test classes, JUnit rules, custom matchers),
build a call graph two levels deep from each test, and resolve a call to a
project helper to the assertions it contains. Cache the index by content hash
so a 1,000 file PR stays under the 30 second budget. This removes the last
reason A001 needs configuration and makes O001 honest about tests whose only
oracle is a helper.

### 4.3 Coverage as evidence

Read lcov, Cobertura and JaCoCo files the same way JUnit XML is read. Join
changed production lines to executed lines: a changed line that no test
executed is a new finding family (C rules in the catalogue), and a deleted
test whose lines are still covered by another test is a moved test, not a lost
one. Per test coverage (pytest-cov contexts, JaCoCo per test sessions) upgrades
"the test ran" to "the test ran the code this PR changed".

### 4.4 Targeted mutation on request

The strongest oracle question is "would this test notice if the code were
wrong". Run PIT, Stryker or mutmut on the changed production lines only, on a
`/testwitness mutate` comment, in a separate job that does execute code (so it
is opt in and never on fork PRs). Report mutants on changed lines killed by the
PR's new or changed tests. A new test that kills nothing on the lines it claims
to cover is measured weak, not guessed weak. This resolves the O001 and O002
precision ceiling.

### 4.5 Memory across runs: the repository's own baseline

Keep the last N JUnit results and reports in a workflow artifact or an orphan
branch, aggregates per test. With history the tool can say: this test failed in
3 of the last 5 runs and this PR skips it (hiding a failure, the highest signal
there is); this test is retried on every run (flaky, so a skip with an issue is
reasonable); this file had 12 assertions per test and this PR brings it to 3
(relative, not absolute). Severities become dynamic: the same diff is graded up
when history corroborates it and down when history excuses it. All of it is
counting, none of it is learning.

### 4.6 Change to test mapping

From coverage or, without coverage, from the import graph, know which tests
exercise the production files a PR changed. Then "the PR changed billing.py and
none of the 14 tests that import billing ran in this job" is a finding, and a
deleted test is only high when nothing else exercises what it covered.

### 4.7 In the agent's loop, not only the reviewer's

Ship the report as a stable JSON schema and a small MCP server (`testwitness
check` as a tool) so Claude Code, Copilot and Codex can run it before pushing
and fix their own weakening. The human then sees a PR that already passed. This
is the biggest product lever: the tool stops being a gate agents trip over and
becomes a step agents run. Deterministic findings are ideal input for an agent
because they come with file, line, before and after.

### 4.8 Deterministic fixes as suggestions

For a deleted or loosened assertion the fix is literally in the base commit.
Post it as a GitHub suggested change (restore the assertion, remove the skip)
so one click repairs it. No generation, only the base text.

### 4.9 More runners, more languages

TAP and the JSON reporters first (small readers that fill the same Evidence
object; the rules do not change). Then Kotlin and Go, which share most of the
Java and TypeScript rule shapes, then C# with TRX.

### 4.10 An optional explainer outside the tool

If a team wants prose, a separate opt in step can summarise the findings with a
model, clearly labelled, never changing a verdict or a severity. Keeping it
outside the tool keeps the core reproducible and the Marketplace listing true.

### 4.11 Integrity over time

Aggregate the reports per repository into a trend (findings per PR, share of
PRs with results attached, skip rate, assertion density) so a team sees whether
their test integrity is drifting, and so the study can be repeated every
quarter with the same method.

## 5. Order of work

Before the public launch:
1. A002 semantic pairing (section 4.1), measured on the corpus before merge.
2. First push to github.com/testwitness/testwitness, npm 0.1.0, dogfood on our own PRs.
3. Quiet week on 3 to 5 friendly public repositories; every false positive report becomes a corpus entry before the fix merges.
4. Study published (sampling is running now).
5. Show HN and the community posts.

After the launch, in order:
6. JSON schema plus MCP server for agents (4.7). One day.
7. Helper resolution across the repository (4.2). Two days.
8. Coverage readers and the C rule family (4.3). Three days.
9. Run history and dynamic severity (4.5). Three days.
10. Mutation on request (4.4). Three days, behind an opt in. O001 moves back to medium once it exists.
11. TAP and JSON reporters, then Kotlin and Go.

Everything above keeps the three promises: no model inside, no network, never
runs the scanned repository's code unless the maintainer opts in to the
mutation job.
