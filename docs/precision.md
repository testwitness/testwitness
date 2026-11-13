# Precision on the false positive corpus

Measured 2026-11-13 on 347 public pull requests (corpus/). Precision counts medium and high findings: true positives over true positives plus false positives. Low findings are informational by design (moved, parameterised, refactored, conditional) and are listed but never counted against precision. The held out half was never used to tune a rule. A missed finding is one the label expected and the tool did not emit.

| Rule | Split | True positives | Low (informational) | False positives (medium or high) | Missed | Precision | High severity false positives |
|---|---|---|---|---|---|---|---|
| A001 | all | 12 | 31 | 16 | 3 | 0.43 | 0 |
| A001 | heldout | 6 | 6 | 15 | 0 | 0.29 | 0 |
| A001 | tuning | 6 | 25 | 1 | 3 | 0.86 | 0 |
| A002 | all | 27 | 0 | 1 | 0 | 0.96 | 0 |
| A002 | heldout | 13 | 0 | 1 | 0 | 0.93 | 0 |
| A002 | tuning | 14 | 0 | 0 | 0 | 1.00 | 0 |
| A009 | all | 2 | 0 | 2 | 1 | 0.50 | 0 |
| A009 | heldout | 0 | 0 | 1 | 0 | 0.00 | 0 |
| A009 | tuning | 2 | 0 | 1 | 1 | 0.67 | 0 |
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
| O002 | all | 9 | 39 | 8 | 0 | 0.53 | 0 |
| O002 | heldout | 0 | 8 | 3 | 0 | 0.00 | 0 |
| O002 | tuning | 9 | 31 | 5 | 0 | 0.64 | 0 |
| O006 | all | 0 | 0 | 14 | 0 | 0.00 | 0 |
| O006 | heldout | 0 | 0 | 11 | 0 | 0.00 | 0 |
| O006 | tuning | 0 | 0 | 3 | 0 | 0.00 | 0 |
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
| V004 | all | 11 | 11 | 0 | 0 | 1.00 | 0 |
| V004 | heldout | 6 | 6 | 0 | 0 | 1.00 | 0 |
| V004 | tuning | 5 | 5 | 0 | 0 | 1.00 | 0 |
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
| A001 | 6 | 15 | 0.29 | 0 | 0 |
| A002 | 13 | 1 | 0.93 | 0 | 0 |
| A009 | 0 | 1 | 0.00 | 0 | 0 |
| C002 | 6 | 0 | 1.00 | 0 | 3 |
| C003 | 1 | 1 | 0.50 | 0 | 0 |
| E001 | 2 | 0 | 1.00 | 0 | 0 |
| O001 | 0 | 0 | n/a | 0 | 0 |
| O002 | 0 | 3 | 0.00 | 0 | 0 |
| O006 | 0 | 11 | 0.00 | 0 | 0 |
| R001 | 23 | 7 | 0.77 | 0 | 2 |
| R002 | 3 | 1 | 0.75 | 0 | 0 |
| R003 | 23 | 0 | 1.00 | 0 | 1 |
| R004 | 16 | 0 | 1.00 | 5 | 1 |
| R005 | 5 | 0 | 1.00 | 0 | 0 |
| R010 | 0 | 0 | n/a | 5 | 0 |
| V004 | 6 | 0 | 1.00 | 0 | 0 |
| W002 | 2 | 1 | 0.67 | 0 | 1 |
| W003 | 1 | 0 | 1.00 | 0 | 2 |

## Rules without a public true positive

Three rules that look for blatant weakenings still have no true positive in the corpus after a dedicated search in batch 4 (2026-11-13), so no precision number is claimed for them. Every search below used `gh api search/issues` restricted to merged pull requests, title matches (`in:title`), and was read by hand; repositories under 100 stars or without an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC licence were skipped.

- **R006 (test body emptied or commented out).** Searched titles "comment out test", "commented out tests" across all of GitHub and within the organisations microsoft, Azure, google, googleapis, aws, awslabs, facebook, vercel, getsentry, supabase, cloudflare, DataDog, open-telemetry, kubernetes-sigs, Shopify, mozilla, apache, openai, anthropics, huggingface, langchain-ai, nodejs and npm; "comment out" and "fixme" within 14 groups of popular Python, JavaScript and Java repositories (pandas, scikit-learn, pytest, airflow, transformers, ray, next.js, vite, vitest, jest, angular, storybook, playwright, spring-boot, kafka, flink, camel and others); and "flaky" in the same groups. Every hit either commented out the whole test including its declaration (recorded as R001, for example aws/aws-sdk-java-v2#6891 and storybookjs/storybook#22310), commented out one helper assertion while the test kept others (recorded as A001, Shopify/hydrogen#3657), deleted or skipped the test, or was in a language without a front end (C++, Go, Swift). None left a test declaration with an emptied body.
- **O006 (new test file with no tests collected).** Searched titles "empty test file", "placeholder test file", "remove empty test file" globally and in the same organisations, then followed removals back to the pull request that added the file. The only JavaScript or Python hit (an empty tests/unit/tmp_debug.test.ts added in databricks/databricks-sql-nodejs#588) is in a repository under 100 stars; the others are Go files or repositories without an allowed licence. The engine's O006 findings in the corpus so far are all on fixture or helper files under test directories and are counted as false positives.
- **S004 (snapshot update forced in the test command).** Searched titles "updateSnapshot", "update-snapshots", "jest -u", "snapshot-update" globally and in the same organisations, and "update snapshots" in the 14 repository groups. The hits update snapshot files in a pull request (the honest `snapshot` category), add a UI mode or CLI option to the test tool itself (microsoft/playwright#31584), or pin snapshot updates off in CI. No public pull request in an eligible repository added `-u`, `--updateSnapshot` or an equivalent to the command CI runs.

Regenerate with `pnpm corpus:report`.
