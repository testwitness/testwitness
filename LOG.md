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
