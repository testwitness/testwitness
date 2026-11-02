# Precision on the false positive corpus

Measured 2026-11-02 on 50 public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.

| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |
|---|---|---|---|---|---|---|---|
| A001 | all | 0 | 4 | 24 | 0 | 0.00 | 0 |
| A001 | heldout | 0 | 4 | 1 | 0 | 0.00 | 0 |
| A001 | tuning | 0 | 0 | 23 | 0 | 0.00 | 0 |
| A009 | all | 0 | 0 | 2 | 0 | 0.00 | 0 |
| A009 | heldout | 0 | 0 | 2 | 0 | 0.00 | 0 |
| O001 | all | 0 | 0 | 19 | 0 | 0.00 | 19 |
| O001 | heldout | 0 | 0 | 13 | 0 | 0.00 | 13 |
| O001 | tuning | 0 | 0 | 6 | 0 | 0.00 | 6 |
| O002 | all | 0 | 1 | 0 | 0 | n/a | 0 |
| O002 | heldout | 0 | 1 | 0 | 0 | n/a | 0 |
| R001 | all | 0 | 84 | 19 | 0 | 0.00 | 1 |
| R001 | heldout | 0 | 56 | 5 | 0 | 0.00 | 1 |
| R001 | tuning | 0 | 28 | 14 | 0 | 0.00 | 0 |
| R002 | all | 0 | 3 | 0 | 0 | n/a | 0 |
| R002 | heldout | 0 | 1 | 0 | 0 | n/a | 0 |
| R002 | tuning | 0 | 2 | 0 | 0 | n/a | 0 |
| R003 | all | 2 | 7 | 1 | 2 | 0.67 | 0 |
| R003 | heldout | 2 | 4 | 0 | 1 | 1.00 | 0 |
| R003 | tuning | 0 | 3 | 1 | 1 | 0.00 | 0 |
| R004 | all | 0 | 0 | 0 | 1 | n/a | 0 |
| R004 | heldout | 0 | 0 | 0 | 1 | n/a | 0 |
| R010 | all | 0 | 3 | 0 | 0 | n/a | 0 |
| R010 | heldout | 0 | 2 | 0 | 0 | n/a | 0 |
| R010 | tuning | 0 | 1 | 0 | 0 | n/a | 0 |

Regenerate with `pnpm corpus:report`.
