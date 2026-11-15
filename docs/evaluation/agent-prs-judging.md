# Judging rubric (testwitness 0.1.1 and later builds)

General rules.

- G1. A finding is TP only when the diff shows the event the rule defines (the first paragraph of the rule in `docs/rules.md`) and none of that rule's own documented false positive controls describes the case. If the rule's text says such a case should be low, silent or labelled, and the tool reported medium or high, the finding is FP.
- G2. When in doubt the finding is FP. The tool must earn the TP label. If the diff and the surrounding file do not let the judge confirm the event, FP.
- G3. The message must name the right thing. A finding that points at a real weakening but describes a different event than the one that happened (wrong test, wrong assertion pair) is FP.
- G4. A correct observation is TP even when the change was deliberate and disclosed in the PR text. The rule reports what happened to the tests, not intent. Each TP also gets a tag `disclosed` when the PR title or body states the removal or weakening, or `undisclosed`, so a stricter reading (only undisclosed TPs count as useful) can be computed.
- G5. Severity is not judged separately. A medium or high finding that should have been low by the rule's own text is FP (G1).
- G6. Each finding row is judged alone. Many findings of one shape in one PR are that many rows.

Per rule.

- R001 Test function deleted. TP when a test that existed in the base is gone from the head and no test with the same or a stronger body covers the same behaviour anywhere in the head tree. FP when it was renamed, moved, folded into a parameterised test or table, rewritten into other tests that check the same behaviour, replaced by a near duplicate that stays, removed together with the production code or feature it tested, removed with a dropped language or platform version, or when the function was not a test the runner collects.
- R002 Test file deleted. TP when a file with collectable tests is deleted and its tests do not reappear. FP for moves, rewrites into other files, renames, deletion together with the production code it tested, files with no collectable tests, generated files.
- R003 Newly skipped. TP when a skip, todo, fixme or disable marker was added to a test that ran in the base and the skip is unconditional or its condition is constant. FP when conditional on platform, version or an optional dependency, when the test was already skipped in the base, or when the marker is on a new test.
- R004 Expected failure. TP when an expected failure marker was added to a test that was expected to pass in the base. FP when conditional, or already present.
- R005 Focused test. TP when `.only`, `fit` or `fdescribe` is new in the head on a real test. FP for a non test API with that name.
- R006 Body emptied. TP when a test with statements in the base has none in the head.
- R010 Added then skipped (medium only when the PR text claims coverage). TP when a new test carries an unconditional skip and the PR text really claims that test as coverage. FP otherwise.
- A001 Assertion removed. TP when a modified test lost a check and no remaining or new assertion, helper call, exception expectation or snapshot checks the same thing. FP when the expectation was rewritten to a new value, consolidated, moved to a helper or another test, when the head assertion exists but was not recognised, or when the removed assertion checked removed behaviour.
- A002 Assertion loosened. TP when the same subject is checked by a strictly weaker assertion in the head and nothing else in the test restores the strength. FP when the head is equally exact (a conditional exact value, another spelling), when the pairing is between unrelated assertions, or when a stronger check on the same subject was added.
- A009 Tautology. TP when both operands are the same value by construction. FP for determinism or equality contract checks.
- O001, O002 Weak new test. TP when the new test has no assertion (O001) or only existence checks (O002) by any mechanism, including helpers, and is not a deliberate does not throw test. FP otherwise.
- O006 New test file with no tests. TP when the runner would collect the file by name and it defines no test by any mechanism (inherited, generated, parameterised, registered by a call). FP for helpers, fixtures, base classes, samples, type test files, generated suites, and files the runner does not collect.
- E001 Catch all. TP when a new catch swallows a failure of the code under test and nothing after it asserts on the caught value or on the effect. FP for capture then assert, cleanup, expected error probing with an assertion, background promises, and catches that existed in the base.
- W002, W003, C001, C002, C003, S004, W006. TP when the changed line is in a file that drives the real test run and has the stated effect. FP when it concerns a non test command, a moved line, a generated directory, or a value that did not get weaker. W006 on a repository that does not use testwitness is FP.
- V004 Claim not supported. TP when the PR text really makes the claim (not a template checkbox, not negated, not about another PR) and the diff holds no support: no new test by any wrapper, no new parameter rows, no new snapshot or fixture cases, fewer than two new assertions in existing tests. FP otherwise.
- V003, V005, V006, V008, M001, M002 need results, coverage or mutation input that this replay does not give. Any medium or high finding from them is judged by its message against the diff, and is FP unless the message is true.
- Any rule not listed: judged by G1 to G3.


For rules other than the four proven ones, the finding is judged as if it had been reported at its uncapped severity: G1 and G5 apply to that severity.

Copied from the second untuned replay preregistration; only the title changed. For the tool version under test, read `docs/rules.md` of that build.
