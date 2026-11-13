# Precision on the false positive corpus

Measured 2026-11-13 on 134 public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.

| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |
|---|---|---|---|---|---|---|---|
| A001 | all | 8 | 23 | 0 | 1 | 1.00 | 0 |
| A001 | heldout | 5 | 4 | 0 | 0 | 1.00 | 0 |
| A001 | tuning | 3 | 19 | 0 | 1 | 1.00 | 0 |
| A002 | all | 27 | 0 | 0 | 0 | 1.00 | 0 |
| A002 | heldout | 13 | 0 | 0 | 0 | 1.00 | 0 |
| A002 | tuning | 14 | 0 | 0 | 0 | 1.00 | 0 |
| A009 | all | 2 | 0 | 1 | 1 | 0.67 | 0 |
| A009 | tuning | 2 | 0 | 1 | 1 | 0.67 | 0 |
| E001 | all | 1 | 0 | 0 | 0 | 1.00 | 0 |
| E001 | tuning | 1 | 0 | 0 | 0 | 1.00 | 0 |
| O001 | all | 5 | 5 | 0 | 0 | 1.00 | 0 |
| O001 | heldout | 0 | 3 | 0 | 0 | n/a | 0 |
| O001 | tuning | 5 | 2 | 0 | 0 | 1.00 | 0 |
| O002 | all | 9 | 29 | 5 | 0 | 0.64 | 0 |
| O002 | heldout | 0 | 1 | 0 | 0 | n/a | 0 |
| O002 | tuning | 9 | 28 | 5 | 0 | 0.64 | 0 |
| R001 | all | 17 | 97 | 9 | 2 | 0.65 | 2 |
| R001 | heldout | 13 | 55 | 6 | 2 | 0.68 | 2 |
| R001 | tuning | 4 | 42 | 3 | 0 | 0.57 | 0 |
| R002 | all | 9 | 3 | 0 | 0 | 1.00 | 0 |
| R002 | heldout | 1 | 1 | 0 | 0 | 1.00 | 0 |
| R002 | tuning | 8 | 2 | 0 | 0 | 1.00 | 0 |
| R003 | all | 21 | 8 | 0 | 1 | 1.00 | 0 |
| R003 | heldout | 14 | 4 | 0 | 0 | 1.00 | 0 |
| R003 | tuning | 7 | 4 | 0 | 1 | 1.00 | 0 |
| R004 | all | 11 | 0 | 0 | 0 | 1.00 | 0 |
| R004 | heldout | 7 | 0 | 0 | 0 | 1.00 | 0 |
| R004 | tuning | 4 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | all | 6 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | heldout | 2 | 0 | 0 | 0 | 1.00 | 0 |
| R005 | tuning | 4 | 0 | 0 | 0 | 1.00 | 0 |
| R010 | all | 5 | 12 | 0 | 0 | 1.00 | 0 |
| R010 | heldout | 3 | 1 | 0 | 0 | 1.00 | 0 |
| R010 | tuning | 2 | 11 | 0 | 0 | 1.00 | 0 |
| V004 | all | 6 | 6 | 0 | 0 | 1.00 | 0 |
| V004 | heldout | 5 | 5 | 0 | 0 | 1.00 | 0 |
| V004 | tuning | 1 | 1 | 0 | 0 | 1.00 | 0 |
| W002 | all | 7 | 0 | 0 | 2 | 1.00 | 0 |
| W002 | heldout | 2 | 0 | 0 | 0 | 1.00 | 0 |
| W002 | tuning | 5 | 0 | 0 | 2 | 1.00 | 0 |
| W003 | all | 1 | 0 | 0 | 2 | 1.00 | 0 |
| W003 | heldout | 1 | 0 | 0 | 1 | 1.00 | 0 |
| W003 | tuning | 0 | 0 | 0 | 1 | n/a | 0 |

Regenerate with `pnpm corpus:report`.

## Agent hook replay

Measured 2026-11-13 on the same 134 pull requests. Each one is applied as an uncommitted change on top of its base commit, the way a coding agent leaves it, and the Claude Code Stop hook (`testwitness hook --agent claude`) runs on it with the default settings: it blocks on open high findings only. A block is wrongful when the finding it rests on is not a true positive in the labels above.

* 82 pull requests have at least one true positive finding. The hook blocks 17 of them (21%). 22 have a true positive at high severity; the others carry medium or low findings only, which the hook shows as advice.
* 52 pull requests have no true positive finding. The hook blocks 0 of them. If every high finding blocked, it would block 2.
* Second set, the real world trial of 2026-11-13: the 15 most recent merged pull requests that touch tests in each of 20 popular open source repositories, 300 in all, every medium and high finding judged by hand. Their authors and reviewers accepted them, so nearly every block there is wrongful. If every high finding blocked, the hook would block 12 of them, 9 wrongly. At the default setting it blocks 1, 0 wrongly. These trial numbers are computed from the judged findings of the commit check, which the working tree check reproduces; the hook was not rerun on those repositories.
* A rule blocks in the hook only when none of its high findings was a wrongful block on either set. Rules with a wrongful block on the corpus or in the trial are advice only by default: A001, A009, E001, R001, R002. A maintainer can change the list with `hook.advice_only` in `.testwitness.yml`.
* Rules that produced no high finding on either set (the config, workflow and results rules without a row below, and W006) still block on high: nothing measured speaks against them, and nothing measured speaks for them either.
* On the corpus, with `fail_on: medium` in the base config the hook blocks 50 of the 82 pull requests with a true positive (61%) and 0 of the 52 without one; the last two columns give that setting per rule. V004 reads the pull request text, which does not exist yet when the hook runs, so the hook never reports it.

| Rule | True positives (corpus) | Of them high | Blocked by the hook | Share of true positives blocked | Wrongful blocks if every high finding blocked (corpus) | High findings judged true in the trial | Wrongful blocks if every high finding blocked (trial) | Wrongful blocks at the default, both sets | In the hook | Blocked with fail_on: medium (corpus) | Wrongful blocks with fail_on: medium (corpus) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A001 | 8 | 0 | 0 | 0% | 0 | 1 | 1 | 0 | advice only | 0 | 0 |
| A002 | 27 | 2 | 2 | 7% | 0 | 1 | 0 | 0 | blocks on high | 27 | 0 |
| A009 | 2 | 1 | 0 | 0% | 0 | 0 | 1 | 0 | advice only | 0 | 0 |
| E001 | 1 | 1 | 0 | 0% | 0 | 0 | 9 | 0 | advice only | 0 | 0 |
| O001 | 5 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | blocks on high | 0 | 0 |
| O002 | 9 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | blocks on high | 3 | 5 |
| R001 | 17 | 0 | 0 | 0% | 2 | 1 | 7 | 0 | advice only | 0 | 0 |
| R002 | 9 | 9 | 0 | 0% | 0 | 1 | 6 | 0 | advice only | 0 | 0 |
| R003 | 21 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | blocks on high | 21 | 0 |
| R004 | 11 | 5 | 5 | 45% | 0 | 0 | 0 | 0 | blocks on high | 6 | 0 |
| R005 | 6 | 6 | 6 | 100% | 0 | 0 | 0 | 0 | blocks on high | 6 | 0 |
| R010 | 5 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | blocks on high | 0 | 0 |
| V004 | 6 | 0 | 0 | 0% | 0 | 0 | 0 | 0 | blocks on high | 0 | 0 |
| W002 | 7 | 7 | 7 | 100% | 0 | 0 | 0 | 0 | blocks on high | 7 | 0 |
| W003 | 1 | 1 | 1 | 100% | 0 | 0 | 0 | 0 | blocks on high | 1 | 0 |

In the trial, `fail_on: medium` would block 22 of the 300 pull requests, 21 of them wrongly, so do not lower `fail_on` for the hook until the medium rules are fixed.

The share is low for rules whose true positives are mostly medium: the hook does not block on medium unless the base config sets `fail_on: medium`. The numbers come from `corpus/runner/replay.test.ts`, which fails when this section and the measurement disagree. Regenerate with `pnpm corpus:report`.
