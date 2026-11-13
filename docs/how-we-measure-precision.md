# How we measure precision

The numbers in the README and in [precision](./precision) come from one place: a corpus of public pull requests in `corpus/`, replayed through the engine by `pnpm corpus:report`. This page explains what goes into that corpus, how it is labelled and judged, and what the numbers can and cannot tell you.

## The corpus

347 merged pull requests from public GitHub repositories, each stored as its unmodified diff plus the base and head versions of the changed test files, runner configs, CI workflows and smaller production files.

Most of them are honest changes chosen because a naive detector would flag them: tests moved between files, several tests folded into one parameterised test, assertions extracted into helpers, snapshots updated, framework migrations, tests deleted along with the feature they covered, and pull requests titled as flaky test fixes. These are the false positive controls. The rest are real weakenings, collected per rule: a test skipped, an assertion loosened, a focused test left in, a coverage threshold lowered, and so on. 191 of the 347 entries carry no true positive label; the other 156 carry at least one (counted from the `expected.json` files).

Candidates were found with the GitHub search API, using merged pull requests and title keywords such as "parametrize", "move tests" or "disable flaky test", in repositories with at least 100 stars and an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC licence. Pull requests over 2,000 changed lines were skipped. The diff is produced locally with git from the merge base, the same three dot compare GitHub shows, and never edited by hand. No author or reviewer names are recorded. The full method is in `corpus/README.md`.

## How labels are made

Each entry was read by hand and given an `expected.json`: the findings a correct tool should emit, each with a rule id, a severity, the test it is about where there is one, and a verdict.

- `tp` means the test really was weakened.
- `fp` marks a benign low severity signal the tool is still expected to emit, for example a deleted test that was only moved (R001 low, label `moved`) or a skip conditioned on the platform (R003 low, label `conditional`).
- An honest refactor with nothing worth reporting has an empty list.

The runner then compares the engine's findings with the labels:

- A finding that matches a `tp` label is a true positive.
- A medium or high finding that matches no label is a false positive.
- A low finding that matches no label is informational and is never counted as a false positive.
- A `tp` label with no matching finding is a miss. The tables show misses so that rules the engine cannot see yet stay visible.

In the most recent batch the runner's output was used to point at hunks worth reading closely, and afterwards to confirm a finding or record a miss. Where the reading and the engine disagreed, the label follows the reading. Entries whose honesty could not be settled from the diff were dropped rather than guessed.

## The held out split

Every entry is assigned to a split by the parity of the SHA-256 of its pull request URL, read as an integer: even goes to `tuning`, odd goes to `heldout`. The split is computed when the entry is created, before anyone has read the diff, so the labeller cannot choose it. `corpus/_tools/verify.py` recomputes it for every entry and fails if a stored split differs.

Rules may be tuned on `tuning` entries only. The 163 held out entries are never used for tuning; they exist to measure the false positive rate on pull requests no rule was adjusted for. [Precision](./precision) prints the held out rows separately.

## The promotion rule

A rule gets a headline precision number in the README only when both of these hold:

- the engine confirmed at least 10 true positives for it across the whole corpus, and
- its precision on medium and high findings in the held out half is at least 0.9.

`scripts/gen-docs.ts` applies this rule to `corpus/verdicts.json` and writes the README rule table. Rules with true positives that miss either bar are listed as "measured, not yet promoted" with their numbers. Rules with no true positive at all get no number.

## Why low findings are not counted

Low findings are informational by design. They describe a change a reviewer may want to know about but that is usually fine: a test moved, folded into a parameterised test, refactored, or skipped on one platform. In the PR comment they are collapsed under their own heading. Counting them as false positives would penalise the tool for describing a refactor accurately, and counting them as true positives would inflate precision with findings nobody acts on.

So precision counts medium and high findings. On the held out half the rule is strict: only medium and high true positives go into the numerator. In the table over the whole corpus, a low finding that matches a `tp` label still counts as a true positive (R010, a test added and then skipped, is low by default), and the held out table shows those separately as low true positives.

## The replay on merged pull requests

The corpus is chosen to be hard, so it says little about how noisy the tool is on an ordinary week of pull requests. A second set covers that. On 2026-11-13, testwitness 0.1.0 was run commit to commit on the 15 most recent merged pull requests that touch tests in each of 20 popular open source repositories, 300 in all, and every medium and high finding was judged by hand against the diff. These pull requests were accepted by their authors and reviewers, so nearly every block there would be wrongful.

Only per rule aggregates are kept, in `corpus/trial/hook-trial-2026-11.json`. No repository, person or pull request is named in it. The replay decides which rules the [agent hook](./agent-guard) blocks on by default: a rule blocks only if it has a true positive at high severity in the corpus and no wrongful block at high in either set. W006, a change to the gate itself, is the one exception and blocks without a measurement. If every high finding blocked, the hook would block 12 of the 300 pull requests, 9 of them wrongly. With the default blocking list it blocks 1, and that one is not wrongful.

The trial file is stored, not regenerated. `pnpm corpus:report` reads it and does not rerun those repositories.

## Known limits

- **Small numbers.** The promoted rules rest on 10 to 64 true positives each, and some held out rows rest on fewer than 10. One more false positive moves a precision figure by several points. Treat 1.00 as "no false positive seen yet", not as a guarantee.
- **Rules with no true positive.** 10 rules ship in v0.1 without a single true positive in the corpus, so no precision number is claimed for them. For three of them (R006, O006 and S004) a dedicated search found no eligible public example; the searches are listed in [precision](./precision).
- **Selection bias toward refactors.** Candidates were found by title keywords that point at refactors and flaky test fixes, and true positives were collected rule by rule. The mix of honest and weakened changes is chosen, not sampled, so corpus precision is not the precision you would see on a random pull request. The replay on merged pull requests is the check against that, and it is small too.
- **Only changed files.** The runner rebuilds each entry from the stored base and head files, so rules that need files the pull request did not change see only what was copied.
- **Results are not replayed.** Entries are checked without test results, so rules that need test results, such as V003 (changed test did not run) and V006 (failures in results while the PR claims passing), are not measured here.

## How to reproduce

```bash
pnpm install
pnpm corpus:report
```

For each entry this builds a temporary git repository from the stored base files and applies the head files on top. It first leaves the change uncommitted, the way an agent leaves it, and runs the Claude Code Stop hook on it. Then it commits the change and runs the same check the CLI runs, commit to commit, with the PR title as the PR text (and the PR body for the V004 entries that store one). The precision tables are judged on that commit check. It writes `docs/precision.md` and `corpus/verdicts.json`, and prints every false positive and miss per entry. A full run takes several minutes.

`pnpm gen:docs` then refreshes the README rule table from `corpus/verdicts.json`. `corpus/runner/replay.test.ts`, part of `pnpm test`, fails when the hook section of [precision](./precision) and the measurement disagree.
