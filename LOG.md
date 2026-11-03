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
