# How we measure precision

The numbers in [precision](./precision) come from a corpus of public pull requests in `corpus/`, replayed through the engine by `pnpm corpus:report`. Which rules v0.1 reports at medium or high is decided by a different measurement, an untuned replay on repositories no rule was tuned on (see [proven and unproven rules](#proven-and-unproven-rules)). This page explains what goes into that corpus, how it is labelled and judged, and what the numbers can and cannot tell you.

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

## Proven and unproven rules

The corpus says how a rule does on pull requests chosen to be hard, and its tuning half was used to fix the rules. Neither says how a rule does on an ordinary week of pull requests in a repository nobody tuned it on. That is what an untuned replay measures, and it decides what v0.1 reports at medium or high.

**The untuned replay.** testwitness is run commit to commit on recent ordinary merged pull requests from repositories that were never used to tune any rule, with no change to the rules during or after the run, and every medium and high finding is judged by hand against the diff. In November 2026 that was 300 merged pull requests from 20 such repositories. None of the 60 findings at medium or high was correct.

The rules were then fixed using those 300 pull requests, which made them a tuning set, and the narrowed v0.1 was measured once more on 300 merged pull requests from 20 further repositories, chosen by the same rule written down before the run (the next qualifying repositories in the same star order) and with nothing changed during or after it. As shipped it reported 3 findings at medium or high, 1.0 per 100 pull requests, and none of the 3 was a real weakening: two A002 findings on assertions that became exact checks of a new value, and one R003 finding on a test that already ran nothing before it was skipped. R004 and R005 did not fire at all. With every rule at its uncapped severity, 74 findings would have been raised at medium or high and 1 of them was true, and R001 raised one, which was false, so R001 stays capped. Two judges labelled every finding independently, the second without seeing the first's labels, and a disagreement counts as false. These are the numbers the README quotes. They are small: a handful of findings says little about precision, and it says the tool is quiet on ordinary work, not that it is right.

That first result is why v0.1 is narrow. Four rules are **proven** and report at the severity they give: R003 (test newly skipped), R004 (test turned into an expected failure), R005 (focused test added) and A002 (assertion loosened). Each has at least 15 true positives in the corpus, no false positive at medium or high except one for A002, and no wrongful block at high on the corpus or on the 300 pull request trial below. Every other rule is **unproven**: it still runs, and its findings are capped at low (informational, collapsed in the comment) until it passes an untuned replay of its own. W006, a change to the gate itself, is the one exception and keeps its severity, because it is not a judgement about test code and only a maintainer may acknowledge it.

The list is `PROVEN_RULES` in `packages/core/src/proven.ts`, and the cap is applied in one place, in the engine after all rules ran. A rule moves onto the list only through a replay that did not shape it: the fixes a replay prompts are tuning, so the next replay for that rule needs repositories it has not seen. The order rules are tried in is in the [roadmap](https://github.com/testwitness/testwitness/blob/main/ROADMAP.md); R001 is first.

**Measuring a capped rule.** Each capped finding keeps the severity its rule gave in `uncappedSeverity` in the JSON report. The corpus runner judges every finding at that severity, so the tables in [precision](./precision) show what each rule would say, capped or not, and a rule's numbers keep moving as it is fixed. The golden fixture cases compare at that severity too. A repository that has checked a rule on its own pull requests can opt it back in with a severity in `.testwitness.yml` ([configuration](./configuration#proven-rules-and-the-cap-at-low)).

**What the README claims.** Two numbers, both measured on pull requests no rule was tuned on: findings at medium or high per 100 ordinary pull requests on the untuned replay, and the recall of the four proven rules on the held out weakened pull requests of the corpus (the share of held out true positive labels of those rules that the engine reports at medium or high). `scripts/gen-docs.ts` computes the recall line and writes the rule block of the README from `corpus/verdicts.json`: of the verdicts on held out entries for the four rules, true positives at medium or high over true positives at any severity plus misses.

## Why low findings are not counted

Low findings are informational by design. They describe a change a reviewer may want to know about but that is usually fine: a test moved, folded into a parameterised test, refactored, or skipped on one platform. In the PR comment they are collapsed under their own heading. Counting them as false positives would penalise the tool for describing a refactor accurately, and counting them as true positives would inflate precision with findings nobody acts on.

So precision counts medium and high findings. On the held out half the rule is strict: only medium and high true positives go into the numerator. In the table over the whole corpus, a low finding that matches a `tp` label still counts as a true positive (R010, a test added and then skipped, is low by default), and the held out table shows those separately as low true positives.

## The replay on merged pull requests

A second set, older than the untuned replay above, covers the agent hook. On 2026-11-13, testwitness 0.1.0 was run commit to commit on the 15 most recent merged pull requests that touch tests in each of 20 popular open source repositories, 300 in all, and every medium and high finding was judged by hand against the diff. These pull requests were accepted by their authors and reviewers, so nearly every block there would be wrongful. Rules were later fixed using findings from this set, so it no longer counts as an untuned replay.

Only per rule aggregates are kept, in `corpus/trial/hook-trial-2026-11.json`, judged at the severity each rule gave before the cap. No repository, person or pull request is named in it. The [agent hook](./agent-guard) blocks on the proven rules and W006, and `corpus/runner/replay.test.ts` checks that none of them has a wrongful block at high on the corpus or on this set. If every high finding blocked, the hook would block 12 of the 300 pull requests, 9 of them wrongly. With the default blocking list it blocks 1, and that one is not wrongful.

The trial file is stored, not regenerated. `pnpm corpus:report` reads it and does not rerun those repositories.

## Known limits

- **Small numbers.** The proven rules rest on 15 to 64 true positives each in the corpus, and some held out rows rest on fewer than 10. One more false positive moves a precision figure by several points. Treat 1.00 as "no false positive seen yet", not as a guarantee.
- **Rules with no true positive.** 6 rules ship in v0.1 without a single true positive in the corpus (R006, O006, S004, V003, V005 and V006), so no precision number is claimed for them. For three of them (R006, O006 and S004) a dedicated search found no eligible public example; the searches are listed in [precision](./precision).
- **Selection bias toward refactors.** Candidates were found by title keywords that point at refactors and flaky test fixes, and true positives were collected rule by rule. The mix of honest and weakened changes is chosen, not sampled, so corpus precision is not the precision you would see on a random pull request. The untuned replay is the check against that, and it is small too.
- **Only changed files.** The runner rebuilds each entry from the stored base and head files, so rules that need files the pull request did not change see only what was copied.
- **Results are not replayed.** Entries are checked without test results, so rules that need test results, such as V003 (changed test did not run) and V006 (failures in results while the PR claims passing), are not measured here.

## How to reproduce

```bash
pnpm install
pnpm corpus:report
```

For each entry this builds a temporary git repository from the stored base files and applies the head files on top. It first leaves the change uncommitted, the way an agent leaves it, and runs the Claude Code Stop hook on it. Then it commits the change and runs the same check the CLI runs, commit to commit, with the PR title as the PR text (and the PR body for the V004 entries that store one). The precision tables are judged on that commit check. It writes `docs/precision.md` and `corpus/verdicts.json`, and prints every false positive and miss per entry. A full run takes several minutes.

`pnpm gen:docs` then refreshes the README rule block and `docs/rules.md` from `corpus/verdicts.json`. `corpus/runner/replay.test.ts`, part of `pnpm test`, fails when the hook section of [precision](./precision) and the measurement disagree.
