# Precision on the false positive corpus

Measured 2026-11-03 on 101 public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.

| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |
|---|---|---|---|---|---|---|---|
| A001 | all | 5 | 5 | 19 | 1 | 0.21 | 0 |
| A001 | heldout | 3 | 4 | 2 | 0 | 0.60 | 0 |
| A001 | tuning | 2 | 1 | 17 | 1 | 0.11 | 0 |
| A002 | all | 0 | 0 | 0 | 3 | n/a | 0 |
| A002 | heldout | 0 | 0 | 0 | 2 | n/a | 0 |
| A002 | tuning | 0 | 0 | 0 | 1 | n/a | 0 |
| O001 | all | 0 | 0 | 5 | 0 | 0.00 | 5 |
| O001 | heldout | 0 | 0 | 3 | 0 | 0.00 | 3 |
| O001 | tuning | 0 | 0 | 2 | 0 | 0.00 | 2 |
| O002 | all | 2 | 2 | 0 | 0 | 1.00 | 0 |
| O002 | heldout | 0 | 1 | 0 | 0 | n/a | 0 |
| O002 | tuning | 2 | 1 | 0 | 0 | 1.00 | 0 |
| R001 | all | 15 | 96 | 9 | 0 | 0.63 | 2 |
| R001 | heldout | 12 | 55 | 6 | 0 | 0.67 | 2 |
| R001 | tuning | 3 | 41 | 3 | 0 | 0.50 | 0 |
| R002 | all | 9 | 3 | 0 | 0 | 1.00 | 0 |
| R002 | heldout | 1 | 1 | 0 | 0 | 1.00 | 0 |
| R002 | tuning | 8 | 2 | 0 | 0 | 1.00 | 0 |
| R003 | all | 20 | 8 | 0 | 0 | 1.00 | 0 |
| R003 | heldout | 13 | 4 | 0 | 0 | 1.00 | 0 |
| R003 | tuning | 7 | 4 | 0 | 0 | 1.00 | 0 |
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
| W002 | all | 4 | 0 | 0 | 0 | 1.00 | 0 |
| W002 | heldout | 1 | 0 | 0 | 0 | 1.00 | 0 |
| W002 | tuning | 3 | 0 | 0 | 0 | 1.00 | 0 |
| W003 | all | 0 | 0 | 0 | 1 | n/a | 0 |
| W003 | heldout | 0 | 0 | 0 | 1 | n/a | 0 |

Regenerate with `pnpm corpus:report`.
