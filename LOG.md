# testwitness build log

Running log: what changed, what was verified and how, what is next. Newest at the bottom of each day.

## 2026-11-01 (day 1)

Toolchain in the cloud workspace: Node 22.23.4 (target >=20), pnpm 10.28.0, Python 3.13.18 with pytest 9.1.1, OpenJDK 21.0.12.1, Maven 3.9.11, Gradle at /opt/gradle, git 2.43.0.

Pinned via pnpm-lock.yaml: web-tree-sitter 0.27.1, tree-sitter-java 0.23.5, tree-sitter-typescript 0.23.2, tree-sitter-javascript 0.25.0, tree-sitter-python 0.25.0, saxes 6.

Decisions:
- Hard gate: clearance NOT confirmed. Local only, personal accounts only, no employer names anywhere.
- github.com/testwitness is free (Sajjad checked, 19:20 UTC); he creates the org and keeps it empty until clearance. Target repo: github.com/testwitness/testwitness.
- Model use today: Fable for all work including subagents until the limit, then Opus for judgement and Sonnet/Haiku for mechanical work.
- Smoke tested web-tree-sitter 0.27.1 with all four grammar wasm files and a Query on Java (probe in /tmp/tsprobe): loads and matches.

Done so far: monorepo skeleton (pnpm workspaces, tsconfig project refs, vitest projects unit+fixtures, eslint flat config, CI matrix ubuntu/windows/macos x node 20/22), core types, tree-sitter loader, hash/fingerprint, conventions doc.

End of day 1 state (written 2 Nov 09:58, the Fable weekly limit stopped work at about 14:00 on 1 Nov): core engine, diff parser, config, R/A/O rules written and unit tested; lang-python done; lang-ts and lang-java mid build; JUnit fixtures mostly produced; corpus at 51 entries. Four subagents were cut off and resumed on 2 Nov after the 8am reset.

## 2026-11-02 (day 2)

Verified by running (counts read from vitest output):
- 10:00 core + junit: 91 tests passing. Fixed typescript-eslint vs TypeScript 7 by pinning typescript 6.0.3.
- 10:02 full suite 301 passing after lang-ts (67) and lang-java (63) and lang-python (64) front ends landed. Package exports switched to a `development` condition so vitest uses source and the built CLI uses dist (`pnpm tsc -b` before running the CLI).
- 10:02 CLI `testwitness check` ran end to end on a synthetic repo and reported O001, A001, R001, R003 correctly (see /tmp/twdemo transcript in the session).
- 10:05 V003 (changed test did not run), V004 (claims), V005 (no results), V006 (failures vs claim) with claim phrase detection; 105 core+junit tests.
- 10:06 golden fixture runner (fixtures/runner) builds a temp git repo per case and runs the real CLI path; first case ts-jest/R003-skip-added passes.
- 10:08 W003 (failure suppressed in run command) and S004 (snapshot update in command): 19 unit tests. Full suite 323 passing.
- 10:15 corpus runner (`pnpm corpus:report`) writes docs/precision.md. First honest measurement: many medium/high false positives. Fixed in core from the corpus: R001 controls moved (same body or same name added elsewhere), parameterised, rewritten (PR level count), replaced (container level count), refactored (every assertion survives in a changed file); A001 parameterised credit; A002 pairing bug (unchanged assertions were being paired with edited ones) and polarity separation. A002 false positives went from 12 to 0 on the corpus; R001 medium/high from 35 to 19.

Known gaps to fix next (front end changes, held until the fixture authoring agents finish editing packages/lang-*):
- Name based assertion recognition: any call whose method name starts with assert, check, verify, expect, should or validate (on any receiver, defined anywhere) must count as a custom assertion. Drives most of the remaining A001 (24) and O001 (19) corpus false positives (project helpers, TestObserver style assertResult calls, an assertion library's own suite).
- TestCase needs `parameterised: boolean` so a fold into @MethodSource or a dynamic parametrize counts as a fold (12 R001 FPs in one assertion library).
- TestCase needs `catchAlls` for E001.
- java-junit5-maven JUnit XML cannot be produced here: the workspace proxy denies Maven Central. Sajjad runs `mvn -B test -Dmaven.test.failure.ignore=true` in fixtures/java-junit5-maven/project on his Mac and copies target/surefire-reports/TEST-*.xml into fixtures/java-junit5-maven/junit/.
- Rules shipped so far (13 of the 14 first tag): R001 R002 R003 R004 R005 R006 R010 A001 A002 A009 O001 O002 O006 V003 V004 V005 V006 W003 S004. Missing from the first tag: E001 (needs catchAlls).

### Day 2 evening (21:30 to 22:30, after the 5 hour limit reset)
Verified by running, counts read from output:
- Unit: 356 passing (core 121, junit 20, lang-ts 78, lang-java 82, lang-python 70, fixtures runner split per project).
- Golden fixtures: 494 passing across 9 fixture projects (java-junit5-maven 158, java-junit4-gradle 19, java-testng-maven 13, ts-jest 118, ts-vitest 14, ts-playwright 10, ts-mocha 11, py-pytest 130, py-unittest 21). Each case builds a temp git repo with two commits and runs the real CLI path.
- Corpus: 50 public PRs (45 honest refactors, 5 true positives), 23 tuning / 27 held out. Medium or high false positives per rule, all entries: R001 8 (was 35 this morning), A001 18 (17 of them one PR whose assertion helpers are named did_create / did_not_create and need assertions.extra), O001 4 (3 race tests with no assertion at all, arguably correct), A002 0 (was 12), A009 0, R003 0 with 4 of 4 true positives. Table in docs/precision.md.
- Rules shipped: R001 R002 R003 R004 R005 R006 R010 A001 A002 A009 O001 O002 O006 E001 S004 W003 V003 V004 V005 V006. That is the full 14 rule first tag plus six from the v0.1.x list.
- Front ends: name based custom assertions (assert*, check*, verify*, expect*, should*, validate* on any receiver), parameterised flag, catch all collection, TESTWITNESS_ASSET_DIR for the bundled action, in all three languages.
- Action: packages/action plus action.yml; `pnpm bundle:action` builds dist/index.js (2.1 MB) and dist/assets (wasm grammars and queries). Ran the bundle standalone from /tmp against the demo PR with a fake event payload: annotations, outputs and findings correct (A002, O001, A001, R003 warnings; R001 replaced, V004 unreadable, V005 as notices).
- Docs: README, design.md, CONTRIBUTING, SECURITY, LICENSE (Apache 2.0).

Decisions taken (reversible, flag if you disagree):
- Helper extraction into a same file helper is silent for A001 (the helper resolves to assertions). Three fixture expectations changed from low consolidated to nothing.
- Deleted test or test file whose production code was deleted in the same PR: low with label "production removed" rather than silent, so the reviewer still sees it collapsed.
- R001 "rewritten" control: when other changed test files in the PR gained at least as many tests as the PR deleted, the deletion is low. Precision over recall; documented in the rule docs and design.md.
- Low findings are informational and never counted against precision; precision is measured on medium and high only.
- `@Test(expected = AssertionError.class)` in JUnit 4 and TestNG is treated as an expected failure marker (R004).

Open for Sajjad:
- java-junit5-maven JUnit XML: run `mvn -B test -Dmaven.test.failure.ignore=true` in fixtures/java-junit5-maven/project and copy target/surefire-reports/TEST-*.xml into fixtures/java-junit5-maven/junit/ (Maven Central is blocked from the workspace).
- Clearance still not confirmed; nothing is public.

Next (day 3): V003 end to end fixtures with the real JUnit XML per producer; benchmark fixture (1,000 file PR); comment command acknowledgement; provenance in the comment verified on a real event payload; Stryker on core; docs site; study scripts.

## 2026-11-03 (day 3)

Clearance confirmed by Sajjad at 22:40 on 2 Nov (personal laptop, no employer conflict). Public commits, packages and posts allowed once v0.1 meets the quality bar. Two pre push fixes requested: true positives per rule in the corpus (README lists only measured rules until then, done via `pnpm gen:docs`), and commit authors rewritten to his GitHub noreply address (scripts/rewrite-authors.sh, needs the address).

Verified by running:
- 01:58 unit 402 passing after the restart; history clean of Stryker instrumentation (an in place Stryker run had instrumented packages/core and a commit captured it; the commit was redone from Stryker's backup and verified by re instrumenting; `git grep stryMutAct` over all commits is 0; 888 stray `// @ts-nocheck` headers removed from fixtures, corpus copies and sources).
- Rules now 22: added W002 (continue-on-error on a test step or job) and W006 (gate weakened, maintainer only acknowledgement). Acknowledgement by comment command and label implemented in core and the Action.
- Front ends: override only tests (`super().test_x()` bodies) in Java and Python feed R003/R004 (label override) and silence O001 and R010; Python records per case marks in pytest.param and conditional xfail (R004 low conditional, medium one case).
- Evidence join proven on every real producer: 61 V003/V004/V006 golden cases; test.each template titles matched by regex; nested parametrisation brackets and describe separators normalised. Fixture suite 555 cases.
- Benchmark (bench/): synthetic 1,000 file PR with 300 test files and 211 MB of JUnit XML runs in 16.4 s wall, 436 MB RSS on this 2 core container (budget 30 s).
- Docs site (VitePress) with quick start, how it decides, evidence, configuration, cli, security, rules (generated), precision, design; pages workflow; dogfood workflow in strict mode; release workflow with attestations and npm trusted publishing; issue and PR templates; code of conduct; good first issues; launch drafts (Marketplace text, Show HN first comment).
- Corpus: 89 entries after the first true positive batch (R003 10, R004 6, R001 6, A001 5, R002 3, R010 3, A002 3, W002 3, O002 1); GitHub secondary rate limit stopped the collector. Second batch running with 8 s pacing. Engine misses recorded by the collector and fixed: overrides, conditional xfail, pytest.param marks, W002.

In flight: Stryker sandbox run (25 minute cap, incremental file kept for the next run), corpus batch two (Opus), study scripts with a 10 PR smoke test (Opus).

Open for Sajjad: GitHub noreply email for the author rewrite; the JUnit 5 Maven fixture run on his Mac.

### Day 3, 04:30
- Unit 704 passing (30 files), golden fixtures 555 passing, lint and typecheck clean, mutation 55.8 percent (sandbox mode, weekly workflow).
- Corpus 101 entries. True positives engine confirmed, all entries: R001 15, R002 9, R003 20, R004 11, R005 6, R010 5, A001 5, O002 2, V004 6, W002 4, W003 1. Medium or high false positives: R001 9 (cross file rewrites, fixture folds), A001 19 (17 from one PR with helpers named did_create, needs assertions.extra), O001 5 (3 race tests with no assertion at all, one verbose output test, one test whose oracle is a thrown parser error). Zero false positives for R002, R003, R004, R005, R010, V004, W002, W003, O002, A002.
- README now lists the 11 rules with measured true positives (generated); the 11 others are named as unmeasured.
- Engine changes from the corpus: override only tests, class existence for override semantics, Java disabled overrides of inherited tests, Python module level mark aliases, per case marks, W002 step names and retry actions, W003 gradle scripts, Python is None strength.
- Study scripts (study/) complete with a 13 PR smoke run; full 500 PR sampling needs several hours of paced GitHub search and is a Sajjad decision on when to spend it.
- Still empty of true positives: R006, A009, O001, O006, E001, S004, A002 (its 3 corpus labels are v0.2 shapes), V003/V005/V006 (need XML). The collector found no public PRs for these at or above 100 stars within the rate limit; golden fixtures prove recall for them.

## 2026-11-04 (day 4)

Sajjad at 02:21: clearance confirmed again (personal laptop, personal accounts), Maven JUnit 5 XML produced on his Mac and granted the ~/testwitness folder, so the two Surefire files were pulled directly. Decisions at 04:17: Option A (all 22 rules enabled, README keeps the measured and unmeasured split), O001 ships at low until mutation on request exists, A002 semantic pairing before the public launch, then JSON schema plus MCP server, then the rest of the roadmap in order; a quiet week on 3 to 5 friendly repositories before Show HN.

Verified by running (counts at 05:20):
- Unit 790 passing (44 files), golden fixtures 601 cases (610 tests with the per project "has cases"), lint and typecheck clean, pnpm pack:check passing (tarball 23 files, 772 kB packed, three language check from a fresh npm install), benchmark large case 12.0 to 12.8 s wall and 365 MB RSS on 2 cores (budget 30 s).
- Corpus 134 entries, 0 verify errors. Engine confirmed true positives: R001 17, R002 9, R003 21, R004 11, R005 6, R010 5, A001 8, A002 27, A009 2, O001 5 (low), O002 9, E001 1, W002 7, W003 1, V004 6. Medium or high false positives: R001 9, O002 5, A009 1, all others 0. Nothing found in public PRs for R006, O006, S004 after a full day of search (every "commented out test" PR was R001 or R003).
- A002 rewritten: one strength lattice across the three languages (equality, ordered, containment, bound, non empty, existence), subject normalisation (identity accessors, boolean wrappers, local bindings, spread copies, comprehensions), matcher chains (AssertJ, Hamcrest, PyHamcrest, Chai), QUnit added. 3 to 27 confirmed true positives, 0 false positives, property tests with fast-check.
- A001: assertions replaced one for one by new helper calls drop a step with label "replaced by call" (17 false positives in one PR to 0); precision 0.21 to 1.00.
- O001: assertions in nested scopes (anonymous classes, lambdas, local classes, nested defs, callbacks) now count in Java and Python; default severity low.
- JUnit reader: the same raw test failed in one file and passed in another is flaky (Surefire rerun split across TEST-*.xml). 11 Maven JUnit 5 evidence cases on the real XML.
- Action: PR author and user.type from the event payload reach provenance; proven on a real shaped payload and a bundle run from /tmp. Dogfood workflow reviewed, nothing broken (fork PRs: annotations and summary, comment fails soft).
- Packaging: one unscoped npm package `testwitness` (bundled CLI plus grammars and queries), the five internal packages private; the @testwitness npm scope belongs to an unrelated project (QA evidence capture extension, created 27 Oct 2026). Release workflow: npm 11 trusted publishing, first 0.1.0 publish is manual by Sajjad, publish step skips a version already on the registry. EPIPE on a closed pipe exits 0.
- Docs: docs/launch/push.md (first push runbook, every command Sajjad runs), docs/launch/communities.md (rules read live on 4 Nov where reachable; reddit and Lobsters blocked from here), docs/launch/quiet-week.md (8 candidate repositories and a maintainer note), docs/ASSESSMENT-AND-ROADMAP.md (honest assessment, gaps, how it gets intelligent without a model, order of work with the 4 Nov decisions).
- Study: full 500 plus 150 sampling started 04:10 in the background (study/logs/).

Open for Sajjad: GitHub noreply address (or run the rewrite command in push.md after cloning the next bundle), first push per docs/launch/push.md, pick the quiet week repositories, Maven version used on the Mac for PRODUCER.md.

Known gaps carried: R001 9 false positives (cross file rewrites), O002 5, A009 1 (cached call compared with itself); W002 expressions and W003 in shell scripts (corpus misses, documented); the published manifest keeps a development exports condition pointing at src (CLI use unaffected).

### Day 4, 13:30
Verified by running (unit 1111 in 65 files, golden fixtures 688 cases in 10 projects, lint and typecheck clean, docs site builds, pack:check passing, benchmark large 13.8 s median on 2 cores with 201 MB of XML, budget 30 s). 68 commits.
- Roadmap items 6 to 11 shipped since the 05:20 entry: report JSON schema v1 and `testwitness mcp` (three read only tools, config shapes checked against the Claude Code, Cursor and Codex docs); helper index (asserting helpers in other test support files count, cache outside the checkout); C001 test selection narrowed, C002 coverage threshold lowered or removed, C003 passing with no tests, V008 uncovered change (lcov, Cobertura, JaCoCo readers; coverage.py and Vitest output real, JaCoCo hand written until a Maven run replaces it); run history (20 run window per test key as a workflow artifact, three severity changes, real history documents produced by the engine); mutation on request (Stryker JSON real from StrykerJS 10.1.1, PIT XML hand written until a Maven run, M001 and M002, `mutate-plan`, maintainer gated workflow template, mutmut unsupported because it has no machine readable per line output); results readers for TAP 13 and 14, Jest and Vitest JSON, pytest json-report and Playwright JSON, all from real tool output with producer notes, new fixture project ts-node-test, `results` is the preferred input and `junit` stays as an alias.
- Independent review (fresh Opus agent, read the whole diff since 2d38268): 19 findings fixed with regression tests. Serious: fork runs could forge the history artifact (now only push, schedule and workflow_dispatch runs from this repository are read); quadratic regexes on PR controlled text (name keys 28 s on 100 kB, TAP lines, INI and Gradle config, workflow lines, C001 selector regexes from the PR's own config) replaced by linear scanners and a safe regex check that fails closed. Also: symlinks in report paths not followed by default (paths.followSymlinks for Bazel), caps on XML and TAP (1,000 files, 500 MB), config text cap 1 MB failing closed, mentions and bare links neutralised in the comment, state recomputed with the right signals after acknowledgements, label acknowledgement checks who applied the label, fork mutation gate needs 12 sha characters, reader errors become notes.
- 26 rules. README: 15 measured, 11 unmeasured (C001 to C003, V008, M001, M002 cannot have public PR positives except the C rules).
- Study: 59 accepted at 17:13 UTC after the restart at 15:08 (container restart killed the first run at 33); about 14 to 20 accepted per hour, 95.9 percent of candidates rejected for repositories under 100 stars. Pace note in study/PACE.md with two options for Sajjad.
- Stryker on the engine started 13:35 local in the background (50 minute cap).

Open for Sajjad: first push (docs/launch/push.md), quiet week repositories, study pace option, Maven run on the Mac for the JUnit 5, JaCoCo and PIT fixture output (one command: mvn -B test -Dmaven.test.failure.ignore=true in fixtures/java-junit5-maven/project, then org.pitest:pitest-maven:mutationCoverage for PIT), Maven version for PRODUCER.md.

## 2026-11-13 (long run, cycle 1)

The public repository github.com/testwitness/testwitness is the source of truth; the old bundle is retired. Public main holds PR 1 (CI on ubuntu, windows and macos, Node 22 for development, "check" aggregate job) and PR 2 (bin path, portable pack:check, docs build). It was pushed from the 4 Nov 05:20 state, so twelve commits made on 4 and 5 Nov were not public. They are ported onto main on branch port/day4-afternoon: report schema and MCP server, helper index, C001 to C003 and V008, run history, mutation on request, TAP and JSON results, the independent review hardening, Stryker fixes.

Found while porting:
- packages/core/src/coverage/ and the seven V008 fixture coverage files had never been committed anywhere, because .gitignore ignored every directory named coverage/ and reports/. The ignore rules are now anchored at the root (/coverage/, /reports/) and the files are in the C rules commit.
- PR 1's Windows glob fix and the hardening rewrite of loadEvidence collided; the conversion now lives in one splitGlobs helper used by results, coverage and mutation.
- The fixture runner globs for coverage, mutation and results use forward slashes like the JUnit glob.
- pack:check steps added after PR 2 spawned the bin directly; they now go through node and bin/testwitness.js like the portable runner.
- action.yml declared runs.using node20. GitHub removed node20 from hosted runners on 23 Sep 2026, so the Action is moved to node24 on its own branch fix/action-node24 (bundle target node24 too; the npm CLI still supports Node 20).
- Commit authors on the port are reset to the noreply address.

Verified on the port branch (Node 22, this container): typecheck and lint clean, unit 1111 in 55 files, golden fixtures 698 in 10 files, docs site builds, pack:check passing, actionlint clean apart from the expected dist/index.js note for uses: ./ in the dogfood workflow (it builds the bundle first).

Running: study sampler (old workspace, resumes from its checkpoint at 146 of 650), Stryker on the port branch (14,203 mutants), and five parallel agents on their own branches: complaint research (Track B), corpus to 300 (corpus/expand-300), CRLF fixtures and Windows path tests (fix/crlf-windows), benchmarks on three sizes in CI (ci/bench-matrix), real world replay on 20 repositories (trial/replay).

Delivery: patches and one apply.sh per batch in ~/Project AI Builder/testwitness/outbox/<date>-<n>/; Sajjad runs one line; decisions in DECISIONS.md.

Resume from here: `git clone https://github.com/testwitness/testwitness`, check open PRs, then the branches named above in /home/claude/work/<branch with slash replaced by dash>.

## 2026-11-13 (cycle 2)

Batch 1 was pushed as PR #3 (node24) and PR #4 (the port); not merged at the time of writing. Read access to checks is only through the public pages: PR #4's ubuntu test passed; the other results were not visible without signing in.

Integrated on branch int/batch2 (stacked on PR #4, 67 commits), each part verified on its own branch first:
- fix/crlf-windows: line ending only changes are not changes (git diff --ignore-cr-at-eol), front ends read CRLF as LF, Windows paths for coverage, mutation, history and globs, helper cache keyed on content; 107 CRLF and mixed fixture cases.
- fix/trial-precision: a replay of 300 merged PRs on 20 popular repositories found precision 0.04 on medium and high (5 of 129). Fixes for O006 support files, V004 template checkboxes and negation, E001 capture then assert, R001 and R002 moves and removed production code, empty diff no longer reads as pass, default base from origin/HEAD, --diff-only, local use docs. Replay after: 0.42 (5 of 12), every true positive kept.
- perf/git-batch: one git cat-file --batch process instead of one git show per file; 1,000 file PR 20 to 26 s before, 8 to 13 s after on the same machine, identical findings.
- ci/bench-matrix: 100, 1,000 and 5,000 file benchmarks with budgets enforced, ubuntu on PRs, all three operating systems on main and on a bench label.
- feat/agent-guard: `check --worktree`, `hook --agent claude|cursor|codex|git`, `init`, a Claude Code plugin, a loop guard, crash and timeout allow; blocks by default only on rules the replay proves (A002, C001, C002, R004, R005, W003, W006). 15 of 16 acceptance criteria met; recorded live sessions are the open one. Built from a study of 89 dated developer complaints (internal: claude/TESTWITNESS-RESEARCH-*.md in the project).
- corpus/expand-300: 347 entries (163 held out by URL hash), README promotes a rule only with 10 confirmed true positives and held out precision of at least 0.9 (R003, R004, R005, A002, C002, V004 today).
- docs/launch-readiness: ten good first issues with a script to open them, ROADMAP.md, README claims trimmed.
- Integration fixes: snapshot plus batch reader in one engine entry, diff flags merged (CRLF plus no textconv), hook benchmark in its own runner (p95 0.87 s and 1.15 s), every action moved to a node24 release, docs build TypeErrors fixed, A001, A009 and O002 default to low.

Verified on int/batch2: typecheck and lint clean, 2817 tests (unit, fixtures and the corpus replay) with 2 skipped, pack:check passing, docs build clean, actionlint clean.

Integrated bundle replay: precision 0.50 on medium and high (4 of 8), high 3 of 3.

## 2026-11-13 (cycle 3)

Batch 2 is ready in outbox/2026-11-13-2 (67 patches); it needs PR #3 and #4 merged first. Batch 3 stacks on it (branch int/batch3, 17 commits):
- fix/precision-3: the last three medium false positives of the replay are low now. A001: an assertion inside an exception expectation (pytest.raises, assertRaises, assertThrows, a narrowed toThrow) is not the oracle. O002: a regression claim in the PR text no longer raises a test whose checks are all does not throw checks. R001: deleting a near duplicate of a test that stays is low, only when the kept test adds checks and nothing else. Replay on the same 300 PRs: 4 of 4 medium and high findings true, every earlier true positive kept. These PRs were used to find the fixes, so this is a tuning number, not a held out one. Corpus: O002 held out false positives 3 to 0, no promoted rule changed.
- feat(cli): plain text at a terminal (findings high first with before and after, colour unless NO_COLOR, control characters from untrusted text replaced); markdown stays the default for pipes, files and CI.
- docs/first-screen: README first screen (one sentence, a demo GIF recorded from a real run, a one line install, measured numbers), docs/how-we-measure-precision.md.
- docs/no-names: public prose names no repository; docs/launch moved out of the repository to ~/Project AI Builder/testwitness/launch on the Mac. Corpus data and fixture attribution stay (DECISIONS).
- ci/mutation-shards: the weekly Stryker run never fit in 90 minutes (a local run estimated 28 hours on two cores), so it is split into eleven parallel shards over core, the junit reader and the three front ends, with a per package score.

Verified on int/batch3: typecheck and lint clean, 2842 tests with 2 skipped (77 files), corpus report unchanged, docs build clean, pack:check passing, actionlint clean apart from the expected dist/index.js note.

Time to first finding, CLI path: installing the packed tarball into a fresh npm prefix took 0.6 s and `testwitness check --base <base>` on a real merged PR in a cloned repository took 1.7 s, so 2.3 s plus the npm download. The Action path is not measured yet.

Running: study sampler (265 of 650), study fetch for the accepted PRs.

## 2026-11-13 (cycle 4)

PR #3 merged. PR #4 failed on Windows (three tests, two of them the history path and the skipped link note) and its self check flagged the repository's own fixture cases. PR #4 and batches 2 and 3 are replaced by one chain on current main, opened one pull request at a time by the same apply.sh:
- A: .testwitness.yml ignores the fixture cases, projects and results and corpus/entries/**, and the self check workflow records history on main. It changes the gate, so the self check reports W006 there by design; the author cannot acknowledge W006, so that one check stays red on A only. The required check passes.
- B: the port and the v0.1 hardening (81 commits, the Windows history path fix among them), plus three fixes found by running the self check here: the skipped link note names paths with forward slashes; paths.ignore reaches every rule, the configuration and workflow rules included (.testwitness.yml itself is never ignored); V003 reads template literal titles in loops as templates and the TypeScript front end reads escapes in quoted titles. Verified: 2819 tests with 2 skipped, corpus report unchanged, pack:check and docs build clean, and the self check run locally against A has no high finding.
- C: the launch polish, the corpus README note on what an entry means, and a packed tarball no longer committed. Verified: 2846 tests with 2 skipped, corpus report unchanged, pack:check and docs build clean, self check against B passes with no finding.
Windows and macOS checks cannot be read from here; Sajjad pastes the failing log after each push.

## 2026-11-14 (cycle 5)

CI is now read directly from the public API (runs, jobs, annotations) from Sajjad's Mac; no logs are relayed.

- PR 6 (the port and hardening): green on the required check after three follow ups. macOS: hook paths compared through the /var link. Windows: the batch git reader did not wait for its process, test payloads pasted raw Windows paths into JSON, 8.3 short paths in the test helpers. Decision (Sajjad): v0.1 supports Linux and macOS; the Windows job runs on every PR but is out of the required check until it is green for a week (issue text in the outbox).
- Untuned replay 1: the frozen tool on 300 merged PRs from 20 repositories never looked at. Two independent judges: 0 of 60 medium and high findings correct (Wilson 95% upper bound 6%).
- Decisions (Sajjad): cut run history, coverage on changed lines (V008 and readers) and mutation on request from v0.1, kept on the branch experimental; v0.1 reports only R003, R004, R005 and A002 at medium or high, every other rule capped at low until it passes an untuned replay; the hook blocks on the same set (plus W006, the gate itself). Do not publish the tuned 4 of 4.
- Security review: 19 findings fixed, 1 open (quadratic tree-sitter read on pathological input), 310,000 fuzz cases; the serious one was a PR's own .testwitness.yml read when the base had none.
- The false shapes of replay 1 were fixed using it as a tuning set: 60 medium and high findings to 7 there (a tuning number).
- Untuned replay 2: the narrowed tool on 300 more PRs from 20 more unseen repositories. As shipped: 3 findings at medium or high (1.0 per 100 PRs), none a real weakening. R004 and R005 did not fire. R001 raised one uncapped finding, false, so it stays capped. Uncapped, all rules raised 74 findings at medium or high and 1 was true (two judges, agreement 72 of 74).
- README claim: that noise number next to recall on the held out weakened PRs of the corpus (57 of 64, 89%).
- Also built: release workflow with a dry run and tested scripts, the Action's comment token default (the README snippet never commented before), MCP registry and Claude plugin metadata, `check --pr <url>`, the summary counting capped findings, the demo repository content (9 PRs) and a session kit for recorded agent runs.
