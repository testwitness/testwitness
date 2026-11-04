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
- Name based assertion recognition: any call whose method name starts with assert, check, verify, expect, should or validate (on any receiver, defined anywhere) must count as a custom assertion. Drives most of the remaining A001 (24) and O001 (19) corpus false positives (pip, django, rxjava TestObserver.assertResult, assertj's own suite).
- TestCase needs `parameterised: boolean` so a fold into @MethodSource or a dynamic parametrize counts as a fold (assertj 12 R001 FPs).
- TestCase needs `catchAlls` for E001.
- java-junit5-maven JUnit XML cannot be produced here: the workspace proxy denies Maven Central. Sajjad runs `mvn -B test -Dmaven.test.failure.ignore=true` in fixtures/java-junit5-maven/project on his Mac and copies target/surefire-reports/TEST-*.xml into fixtures/java-junit5-maven/junit/.
- Rules shipped so far (13 of the 14 first tag): R001 R002 R003 R004 R005 R006 R010 A001 A002 A009 O001 O002 O006 V003 V004 V005 V006 W003 S004. Missing from the first tag: E001 (needs catchAlls).

### Day 2 evening (21:30 to 22:30, after the 5 hour limit reset)
Verified by running, counts read from output:
- Unit: 356 passing (core 121, junit 20, lang-ts 78, lang-java 82, lang-python 70, fixtures runner split per project).
- Golden fixtures: 494 passing across 9 fixture projects (java-junit5-maven 158, java-junit4-gradle 19, java-testng-maven 13, ts-jest 118, ts-vitest 14, ts-playwright 10, ts-mocha 11, py-pytest 130, py-unittest 21). Each case builds a temp git repo with two commits and runs the real CLI path.
- Corpus: 50 public PRs (45 honest refactors, 5 true positives), 23 tuning / 27 held out. Medium or high false positives per rule, all entries: R001 8 (was 35 this morning), A001 18 (17 of them one pip PR whose assertion helpers are named did_create / did_not_create and need assertions.extra), O001 4 (3 rxjava race tests with no assertion at all, arguably correct), A002 0 (was 12), A009 0, R003 0 with 4 of 4 true positives. Table in docs/precision.md.
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
- Corpus 101 entries. True positives engine confirmed, all entries: R001 15, R002 9, R003 20, R004 11, R005 6, R010 5, A001 5, O002 2, V004 6, W002 4, W003 1. Medium or high false positives: R001 9 (kafka and sklearn rewrites, pandas fixture folds), A001 19 (17 from one pip PR with helpers named did_create, needs assertions.extra), O001 5 (3 rxjava race tests with no assertion at all, one sklearn verbose test, one govuk test whose oracle is a thrown PostCSS error). Zero false positives for R002, R003, R004, R005, R010, V004, W002, W003, O002, A002.
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
- A001: assertions replaced one for one by new helper calls drop a step with label "replaced by call" (pip 17 false positives to 0); precision 0.21 to 1.00.
- O001: assertions in nested scopes (anonymous classes, lambdas, local classes, nested defs, callbacks) now count in Java and Python; default severity low.
- JUnit reader: the same raw test failed in one file and passed in another is flaky (Surefire rerun split across TEST-*.xml). 11 Maven JUnit 5 evidence cases on the real XML.
- Action: PR author and user.type from the event payload reach provenance; proven on a real shaped payload and a bundle run from /tmp. Dogfood workflow reviewed, nothing broken (fork PRs: annotations and summary, comment fails soft).
- Packaging: one unscoped npm package `testwitness` (bundled CLI plus grammars and queries), the five internal packages private; the @testwitness npm scope belongs to an unrelated project (QA evidence capture extension, created 27 Oct 2026). Release workflow: npm 11 trusted publishing, first 0.1.0 publish is manual by Sajjad, publish step skips a version already on the registry. EPIPE on a closed pipe exits 0.
- Docs: docs/launch/push.md (first push runbook, every command Sajjad runs), docs/launch/communities.md (rules read live on 4 Nov where reachable; reddit and Lobsters blocked from here), docs/launch/quiet-week.md (8 candidate repositories and a maintainer note), docs/ASSESSMENT-AND-ROADMAP.md (honest assessment, gaps, how it gets intelligent without a model, order of work with the 4 Nov decisions).
- Study: full 500 plus 150 sampling started 04:10 in the background (study/logs/).

Open for Sajjad: GitHub noreply address (or run the rewrite command in push.md after cloning the next bundle), first push per docs/launch/push.md, pick the quiet week repositories, Maven version used on the Mac for PRODUCER.md.

Known gaps carried: R001 9 false positives (cross file rewrites), O002 5, A009 1 (cached call compared with itself); W002 expressions and W003 in shell scripts (corpus misses, documented); the published manifest keeps a development exports condition pointing at src (CLI use unaffected).
