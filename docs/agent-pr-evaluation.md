# How often do coding agents weaken tests in real pull requests?

A study of 3,142 distinct public pull requests from 60 repositories where coding agents write much of the code, measured in November 2026 with the method committed before any data was collected ([preregistration](./evaluation/agent-prs-preregistration.md), [preregistration 2](./evaluation/agent-prs-preregistration-2.md), [judging rubric](./evaluation/agent-prs-judging.md)). This page gives aggregates only. Every number on it is recomputed from two data files by `node scripts/study-rates.mjs`: [prs.csv](https://github.com/testwitness/testwitness/blob/main/docs/evaluation/data/prs.csv), every pull request in the samples, and [judged.csv](https://github.com/testwitness/testwitness/blob/main/docs/evaluation/data/judged.csv), every candidate a judge called a real weakening and every finding reported at medium or high, with both judges' labels. The files link each pull request so the judging can be audited; a link is not a judgement on anyone who worked on it.

## Limits first

- **Small counts.** Real weakenings are rare, so every rate below rests on a handful of cases and has a wide interval. Read the intervals, not the point estimates.
- **Two bounds for every rate.** Each candidate was judged by two independent judges. The upper bound counts a case when either judge called it a weakening; the lower bound only when both did. The truth is probably in between.
- **"Weakening" means four shapes only:** a test newly skipped, turned into an expected failure, focused, or an assertion made strictly weaker. Deleted tests are not counted, because most deletions in this sample went with the code they tested.
- **Not a random sample of GitHub.** Repositories were found through agent activity and filtered to at least 200 stars and a real test suite. Their pull requests touch tests and change at most 3,000 lines.
- **The samples overlap a little.** 18 pull requests are in both the closed and the restore cohorts, and 91 merged agent pull requests in the restore cohort are also in the merged sample, so the rows below are not independent. Counted once each, the study covers 3,142 distinct pull requests (2,176 merged plus 966 more from the second sample).
- **The restore cohort is loose.** It is agent pull requests whose comments matched a phrase like "restore the test" in GitHub search; nobody confirmed that a reviewer asked for it.
- **Misses are estimated, not counted.** Weakenings were found by a lexical screen over every pull request, by the tool's own findings at any severity, and by reading 60 random pull requests per set in full. A weakening none of those catch is not in the numbers.
- **One deviation.** The preregistered bar for opening the sealed test set could not be met (merged pull requests give about 2 findings per 650), so it was opened once, on the build released as 0.1.2, and recorded as a deviation.

## Findings

| Agent pull requests | Count | With a real weakening, per 100 (upper bound) | Per 100 (lower bound) |
|---|---|---|---|
| Merged | 1,257 | 0.32 (0.12 to 0.82) | 0.16 (0.04 to 0.58) |
| Closed without merge | 670 | 1.04 (0.51 to 2.14) | 0.60 (0.23 to 1.52) |
| Restore phrase in comments | 405 | 1.23 (0.53 to 2.86) | 0.74 (0.25 to 2.15) |

Wilson 95 percent intervals in brackets. Human pull requests in the same repositories, merged: 919, with 2 real weakenings (both judges agreed on both).

- In merged work, agents weaken tests rarely: about 2 to 3 pull requests in 1,000.
- Where reviewers push back, it is about three to five times as common. The intervals still overlap, so this is a direction, not a settled number.
- Most weakenings are quiet: a skip on an existing test, or an exact check replaced by a looser one (a value check turned into a call count, an exact count turned into a range).

## What the tool did

testwitness is a small check: it reports only three shapes at medium or high, R003 (test newly skipped), R004 (expected failure) and R005 (focused test).

- **When it speaks, it has been right.** At medium or high, 0.1.2 reported 3 distinct pull requests across the samples (all R003), and both judges called all 3 real (Wilson lower bound 0.44). On 942 sealed test set pull requests it reported nothing at medium or high.
- **It misses most weakenings.** 16 distinct pull requests had a weakening across both samples (upper bound; 10 on the lower bound), and 0.1.2 reports 3 of them. Of the other 13, 11 made an assertion looser, 1 was a Java skip the tune set fix now catches, and 1 commented tests out of a runner allowlist. Its assertion rule, A002, was right on 1 of 18 findings at medium in this study, mostly because it paired old and new assertions across tests rewritten after the code changed, so 0.1.2 reports A002 at low until that is fixed and re-measured on unseen pull requests.
- **The sealed test set** (942 merged pull requests, 24 repositories): 0 findings at medium or high (at most 0.41 per 100), and 0 of the 4 weakenings found there reported. Two of the four were A002 cases now reported at low, one was a looser assertion A002 does not detect, and one was tests commented out of a runner allowlist, which the tool does not read as tests.
- **Deleted tests stay capped.** R001 was right on 16 of 47 findings in the test set (0.34), so it reports at low.
- **One recall bug was fixed** on the tune set: a `@Disabled` on a Java test with a team's own JUnit 5 test annotation.

## Corrections

- 16 November 2026: two numbers were wrong in the first version of this page. Recomputed from the data files with the stated rule, the upper bound for merged agent pull requests is 4 of 1,257 (0.32 per 100), not 3 (0.24), and for closed agent pull requests 7 of 670 (1.04), not 6 (0.90); one judge split had been resolved the wrong way in each. "R003, 4 of 4" counted one pull request twice because it is in two samples; it is 3 distinct pull requests, all real. The lower bounds did not change.

## How it was measured

- Merged sample: 2,176 pull requests (1,257 agent, 919 human), split by repository into tune (18 repositories), validate (18) and a sealed test set (24). Fixes were designed on tune only.
- Second sample: 1,057 distinct agent pull requests from the same repositories, closed without merge (670) or with a restore phrase in comments (405), 18 in both. 91 of the restore cohort were merged agent pull requests already in the merged sample.
- Agents identified by the signals the tool already reads: the bot accounts of Copilot, Devin, Cursor and the Claude app, and the trailers or links Claude Code, Codex and Cursor leave. Claude Code, Cursor, Devin, Copilot and Codex are represented; others too rarely to count.
- Every finding the tool gave at medium or high, every finding a capped rule would have given at medium or high, every screen hit, and the random reads were labelled by two independent judges with the written rubric. The data files are in [docs/evaluation/data](https://github.com/testwitness/testwitness/tree/main/docs/evaluation/data); the judge packets and full log stay with the maintainers.
