# Precision on the false positive corpus

Measured 2026-11-13 on 347 public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.

| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |
|---|---|---|---|---|---|---|---|
| A001 | all | 14 | 45 | 0 | 1 | 1.00 | 0 |
| A001 | heldout | 5 | 22 | 0 | 1 | 1.00 | 0 |
| A001 | tuning | 9 | 23 | 0 | 0 | 1.00 | 0 |
| A002 | all | 27 | 0 | 1 | 0 | 0.96 | 0 |
| A002 | heldout | 13 | 0 | 1 | 0 | 0.93 | 0 |
| A002 | tuning | 14 | 0 | 0 | 0 | 1.00 | 0 |
| A009 | all | 3 | 1 | 0 | 0 | 1.00 | 0 |
| A009 | heldout | 0 | 1 | 0 | 0 | n/a | 0 |
| A009 | tuning | 3 | 0 | 0 | 0 | 1.00 | 0 |
| C001 | all | 7 | 0 | 0 | 0 | 1.00 | 0 |
| C001 | tuning | 7 | 0 | 0 | 0 | 1.00 | 0 |
| C002 | all | 10 | 0 | 1 | 6 | 0.91 | 0 |
| C002 | heldout | 6 | 0 | 0 | 3 | 1.00 | 0 |
| C002 | tuning | 4 | 0 | 1 | 3 | 0.80 | 0 |
| C003 | all | 1 | 0 | 2 | 1 | 0.33 | 2 |
| C003 | heldout | 1 | 0 | 1 | 0 | 0.50 | 1 |
| C003 | tuning | 0 | 0 | 1 | 1 | 0.00 | 1 |
| E001 | all | 3 | 0 | 0 | 0 | 1.00 | 0 |
| E001 | heldout | 2 | 0 | 0 | 0 | 1.00 | 0 |
| E001 | tuning | 1 | 0 | 0 | 0 | 1.00 | 0 |
| O001 | all | 5 | 18 | 0 | 0 | 1.00 | 0 |
| O001 | heldout | 0 | 10 | 0 | 0 | n/a | 0 |
| O001 | tuning | 5 | 8 | 0 | 0 | 1.00 | 0 |
| O002 | all | 9 | 42 | 5 | 0 | 0.64 | 0 |
| O002 | heldout | 0 | 11 | 0 | 0 | n/a | 0 |
| O002 | tuning | 9 | 31 | 5 | 0 | 0.64 | 0 |
| R001 | all | 32 | 214 | 23 | 3 | 0.58 | 7 |
| R001 | heldout | 23 | 106 | 7 | 2 | 0.77 | 2 |
| R001 | tuning | 9 | 108 | 16 | 1 | 0.36 | 5 |
| R002 | all | 12 | 13 | 3 | 0 | 0.80 | 3 |
| R002 | heldout | 3 | 10 | 1 | 0 | 0.75 | 1 |
| R002 | tuning | 9 | 3 | 2 | 0 | 0.82 | 2 |
| R003 | all | 64 | 15 | 0 | 3 | 1.00 | 0 |
| R003 | heldout | 23 | 5 | 0 | 1 | 1.00 | 0 |
| R003 | tuning | 41 | 10 | 0 | 2 | 1.00 | 0 |
| R004 | all | 28 | 0 | 0 | 1 | 1.00 | 0 |
| R004 | heldout | 21 | 0 | 0 | 1 | 1.00 | 0 |
| R004 | tuning | 7 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | all | 15 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | heldout | 5 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | tuning | 10 | 0 | 0 | 0 | 1.00 | 0 |
| R010 | all | 13 | 12 | 0 | 2 | 1.00 | 0 |
| R010 | heldout | 5 | 1 | 0 | 0 | 1.00 | 0 |
| R010 | tuning | 8 | 11 | 0 | 2 | 1.00 | 0 |
| V004 | all | 9 | 11 | 0 | 2 | 1.00 | 0 |
| V004 | heldout | 5 | 6 | 0 | 1 | 1.00 | 0 |
| V004 | tuning | 4 | 5 | 0 | 1 | 1.00 | 0 |
| W002 | all | 9 | 0 | 2 | 4 | 0.82 | 2 |
| W002 | heldout | 2 | 0 | 1 | 1 | 0.67 | 1 |
| W002 | tuning | 7 | 0 | 1 | 3 | 0.88 | 1 |
| W003 | all | 1 | 0 | 0 | 5 | 1.00 | 0 |
| W003 | heldout | 1 | 0 | 0 | 2 | 1.00 | 0 |
| W003 | tuning | 0 | 0 | 0 | 3 | n/a | 0 |

## Held out half

Entries are split by the parity of the SHA-256 of the PR url (see corpus/README.md), so the labeller does not choose the split. No rule was tuned on these 163 entries. Precision here counts only medium and high findings: medium or high true positives over medium or high true positives plus false positives.

| Rule | True positives (medium or high) | False positives (medium or high) | Precision (medium or high) | Low true positives | Missed |
|---|---|---|---|---|---|
| A001 | 0 | 0 | n/a | 5 | 1 |
| A002 | 13 | 1 | 0.93 | 0 | 0 |
| A009 | 0 | 0 | n/a | 0 | 0 |
| C002 | 6 | 0 | 1.00 | 0 | 3 |
| C003 | 1 | 1 | 0.50 | 0 | 0 |
| E001 | 2 | 0 | 1.00 | 0 | 0 |
| O001 | 0 | 0 | n/a | 0 | 0 |
| O002 | 0 | 0 | n/a | 0 | 0 |
| R001 | 23 | 7 | 0.77 | 0 | 2 |
| R002 | 3 | 1 | 0.75 | 0 | 0 |
| R003 | 23 | 0 | 1.00 | 0 | 1 |
| R004 | 16 | 0 | 1.00 | 5 | 1 |
| R005 | 5 | 0 | 1.00 | 0 | 0 |
| R010 | 0 | 0 | n/a | 5 | 0 |
| V004 | 5 | 0 | 1.00 | 0 | 1 |
| W002 | 2 | 1 | 0.67 | 0 | 1 |
| W003 | 1 | 0 | 1.00 | 0 | 2 |

## Rules without a public true positive

Three rules that look for blatant weakenings still have no true positive in the corpus after a dedicated search in batch 4 (2026-11-13), so no precision number is claimed for them. Every search below used `gh api search/issues` restricted to merged pull requests, title matches (`in:title`), and was read by hand; repositories under 100 stars or without an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC licence were skipped.

- **R006 (test body emptied or commented out).** Searched titles "comment out test", "commented out tests" across all of GitHub and within the organisations microsoft, Azure, google, googleapis, aws, awslabs, facebook, vercel, getsentry, supabase, cloudflare, DataDog, open-telemetry, kubernetes-sigs, Shopify, mozilla, apache, openai, anthropics, huggingface, langchain-ai, nodejs and npm; "comment out" and "fixme" within 14 groups of popular Python, JavaScript and Java repositories (pandas, scikit-learn, pytest, airflow, transformers, ray, next.js, vite, vitest, jest, angular, storybook, playwright, spring-boot, kafka, flink, camel and others); and "flaky" in the same groups. Every hit either commented out the whole test including its declaration (recorded as R001, for example aws/aws-sdk-java-v2#6891 and storybookjs/storybook#22310), commented out one helper assertion while the test kept others (recorded as A001, Shopify/hydrogen#3657), deleted or skipped the test, or was in a language without a front end (C++, Go, Swift). None left a test declaration with an emptied body.
- **O006 (new test file with no tests collected).** Searched titles "empty test file", "placeholder test file", "remove empty test file" globally and in the same organisations, then followed removals back to the pull request that added the file. The only JavaScript or Python hit (an empty tests/unit/tmp_debug.test.ts added in databricks/databricks-sql-nodejs#588) is in a repository under 100 stars; the others are Go files or repositories without an allowed licence. The engine's O006 findings in the corpus so far are all on fixture or helper files under test directories and are counted as false positives.
- **S004 (snapshot update forced in the test command).** Searched titles "updateSnapshot", "update-snapshots", "jest -u", "snapshot-update" globally and in the same organisations, and "update snapshots" in the 14 repository groups. The hits update snapshot files in a pull request (the honest `snapshot` category), add a UI mode or CLI option to the test tool itself (microsoft/playwright#31584), or pin snapshot updates off in CI. No public pull request in an eligible repository added `-u`, `--updateSnapshot` or an equivalent to the command CI runs.

Regenerate with `pnpm corpus:report`.

## Agent hook replay

Measured 2026-11-13 on the same 347 pull requests. Each one is applied as an uncommitted change on top of its base commit, the way a coding agent leaves it, and the Claude Code Stop hook (`testwitness hook --agent claude`) runs on it with the default settings: it blocks on open high findings only. A block is wrongful when the finding it rests on is not a true positive in the labels above.

* 130 pull requests have at least one true positive finding. The hook blocks 25 of them (19%). 43 have a true positive at high severity; the others carry medium or low findings only, which the hook shows as advice.
* 217 pull requests have no true positive finding. The hook blocks 0 of them. If every high finding blocked, it would block 10.
* Second set, the real world trial of 2026-11-13: the 15 most recent merged pull requests that touch tests in each of 20 popular open source repositories, 300 in all, every medium and high finding judged by hand. Their authors and reviewers accepted them, so nearly every block there is wrongful. If every high finding blocked, the hook would block 12 of them, 9 wrongly. At the default setting it blocks 1, 0 wrongly. These trial numbers are computed from the judged findings of the commit check, which the working tree check reproduces; the hook was not rerun on those repositories.
* The hook blocks on a small proven set and treats every other rule as advice. A rule is on the default list when it has at least one true positive at high severity on the corpus and no wrongful block at high on either set: A002, C001, C002, R004, R005, W003. W006 is on the list without a measurement because it is the gate protecting itself. An interruption in the middle of an agent's work costs more than a line in a PR comment, so a rule has to earn the right to block; rules that were wrong at least once (A001, A009, E001, R001, R002 today) and rules that were never seen at high do not block until the replay proves them. A maintainer can widen the list with `hook.blocking` in `.testwitness.yml`, or narrow it with `hook.advice_only`.
* On the corpus, with `fail_on: medium` in the base config the hook blocks 45 of the 130 pull requests with a true positive (35%) and 1 of the 217 without one; the last two columns give that setting per rule (the blocking list stays the same, so only its rules can block).

| Rule | True positives (corpus) | Of them high | Blocked by the hook | Share of true positives blocked | Wrongful blocks if every high finding blocked (corpus) | High findings judged true in the trial | Wrongful blocks if every high finding blocked (trial) | Wrongful blocks at the default, both sets | In the hook | Blocked with fail_on: medium (corpus) | Wrongful blocks with fail_on: medium (corpus) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A001 | 14 | 0 | 0 | 0% | 0 | 1 | 1 | 0 | advice only | 0 | 0 |
| A002 | 27 | 2 | 2 | 7% | 0 | 1 | 0 | 0 | blocks on high | 27 | 1 |
| A009 | 3 | 0 | 0 | 0% | 0 | 0 | 1 | 0 | advice only | 0 | 0 |
| C001 | 7 | 7 | 7 | 100% | 0 | 0 | 0 | 0 | blocks on high | 7 | 0 |
| C002 | 10 | 4 | 4 | 40% | 0 | 0 | 0 | 0 | blocks on high | 10 | 1 |
| C003 | 1 | 1 | 0 | 0% | 2 | 0 | 0 | 0 | advice only | 0 | 0 |
| E001 | 3 | 3 | 0 | 0% | 0 | 0 | 9 | 0 | advice only | 0 | 0 |
| O001 | 5 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | advice only | 0 | 0 |
| O002 | 9 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | advice only | 0 | 0 |
| R001 | 32 | 2 | 0 | 0% | 7 | 1 | 7 | 0 | advice only | 0 | 0 |
| R002 | 12 | 12 | 0 | 0% | 3 | 1 | 6 | 0 | advice only | 0 | 0 |
| R003 | 64 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | advice only | 0 | 0 |
| R004 | 28 | 22 | 22 | 79% | 0 | 0 | 0 | 0 | blocks on high | 23 | 0 |
| R005 | 15 | 15 | 15 | 100% | 0 | 0 | 0 | 0 | blocks on high | 15 | 0 |
| R010 | 13 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | advice only | 0 | 0 |
| V004 | 9 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | advice only | 0 | 0 |
| W002 | 9 | 9 | 0 | 0% | 2 | 0 | 0 | 0 | advice only | 0 | 0 |
| W003 | 1 | 1 | 1 | 100% | 0 | 0 | 0 | 0 | blocks on high | 1 | 0 |

In the trial, `fail_on: medium` with the default blocking list would block 2 of the 300 pull requests, 1 of them wrongly.

The share is low for rules whose true positives are mostly medium: the hook does not block on medium unless the base config sets `fail_on: medium`. The numbers come from `corpus/runner/replay.test.ts`, which fails when this section and the measurement disagree. Regenerate with `pnpm corpus:report`.
