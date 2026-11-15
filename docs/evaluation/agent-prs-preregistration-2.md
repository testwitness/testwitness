<!-- Published copy. The original was committed on 15 November 2026 at commit 179471b944a04441d520a534eb2d3dcd2410279e of the local measurement repository, sha256 4064d63c286d0b5148c776849f21ee0aef1e11aa030572a10d2295957cbbbeab, before any search or collection for it. -->

# Preregistration 2: weakening where reviewers push back

Written 15 November 2026 (UTC), committed before any pull request of this sample was searched for or collected. Changes after the commit go to `DEVIATIONS.md` as D2-n with the reason, before the step they change.

## Hypothesis

Test weakening by coding agents is more frequent in pull requests that reviewers reject or push back on than in merged ones. If so, the merged rate (about 0.24 real weakenings per 100 pull requests in the first sample) understates how often agents weaken tests, and the tool's job is mostly to catch them before review.

## Sample

Same 60 repositories as the first preregistration (`meta/selection.tsv`, selected), same period (created 2026-06-01 to 2026-11-14), same agent attribution (section 3.1 of PREREGISTRATION.md), same pull request eligibility (3.2: at least one test file, 1 to 3,000 changed lines, head fetchable, base computable), except as stated.

- **Cohort C (closed unmerged):** agent pull requests closed without merge. Search: `repo:<r> is:pr is:closed is:unmerged closed:<period>` with each agent query of 3.1. Per repository the most recently closed first, at most 30, at most 15 per agent.
- **Cohort R (reviewer asked to restore):** agent pull requests, merged or closed, whose comments match one of these phrases through GitHub search (`in:comments`), fixed here: "restore the test", "restore this test", "restore the tests", "put the test back", "put back the test", "bring back the test", "re-enable the test", "reenable the test", "unskip", "don't skip", "do not skip", "why skip", "why is this skipped", "why was this test removed", "why remove the test", "why did you remove", "don't delete the test", "do not delete the test", "don't remove the test", "do not remove the test", "don't weaken", "do not weaken", "loosened the assertion", "weakened the test". GitHub's comment search is loose, so a hit means "search matched", not "a reviewer asked"; this is stated in every report. Per repository all hits that pass eligibility, at most 30. A pull request in both cohorts counts in both.
- The diff is `git diff -M <mergebase> <head>`, the head being the last head GitHub kept (`refs/pull/N/head`).

## Measurement

Exactly as sections 5 to 7 of PREREGISTRATION.md, per cohort:

- the tool, build c2 (dist/cli.js sha256 `21bb0e4228c4cadb7748fb49524f172dff052aec81a917484682accf6d670644`), default config, every medium and high finding judged;
- the lexical screen over every pull request, every hit without a matching finding judged;
- a seeded random sample of 60 pull requests per cohort without a shipped finding, read in full by both judges (all of them when a cohort has 60 or fewer);
- two independent judges; a disagreement on a finding counts as false, on a candidate weakening as a real weakening.

## What is reported

- Real weakenings per 100 pull requests per cohort, with Wilson 95 percent intervals, next to the same figure for the merged agent pull requests of the first sample measured the same way (screen plus sample, tune and validate sets, and the test set once its judging is done).
- The rate is a lower bound wherever the random sample, not a full read, stands for the pull requests without a screen hit; the sample's own rate is reported with its interval.
- Recall of c2 on the real weakenings found, and precision of its shipped findings, per cohort.
- Aggregates only: no repository, person or pull request named.

## Seed

The sha256 of this file's commit hash, written to `LOG.md`.
