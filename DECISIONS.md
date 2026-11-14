# Decisions for Sajjad

Each entry: the decision, my recommendation, and the reversible default I am proceeding with. Newest first.

## 2026-11-13: v0.1 narrowed to four proven rules

Decided by Sajjad (13 Nov), after an untuned replay of 300 ordinary merged PRs from 20 unseen repositories found 0 correct findings out of 60 at medium or high: run history, coverage on changed lines (V008) and mutation on request (M001, M002) are cut from v0.1 and kept on the `experimental` branch; only R003, R004, R005 and A002 report at medium or high, and the hook blocks on the same set.

Choices made while doing it, each reversible:
- W006 keeps its severity in the report as well as blocking in the hook. Capping it at low would have made the hook exception empty and would have let a change to `.testwitness.yml` pass `require-ack` without a maintainer. Its replay shows no wrongful block (it never fired on either set).
- Opting a rule back in reuses the per rule severity that already existed: `rules: { R001: medium }`. A mapping without a severity does not opt in.
- The golden fixture cases and the corpus judge findings at `uncappedSeverity`, so they keep testing and measuring every rule. The cap itself has its own unit tests.
- Config keys `coverage`, `mutation` and `history` fail with a ConfigError that names the key.

## 2026-11-13: mutation testing runs in GitHub Actions, not here

The brief asks for a Stryker score above 75 percent on core. A full run is about 14,000 mutants; this workspace has two cores and estimated 28 hours, and the old weekly workflow had a 90 minute limit, so no full score exists yet (the last partial run, 3,055 mutants, killed 30 percent and left 44 percent without coverage, which says more about which files the run reached first than about the suite).

Decided by Sajjad (13 Nov): he runs the workflow once by hand after the last batch merges. Eleven shards run in parallel and the summary job prints the score per package; the survivors become tests in the next batch. The workflow also runs every Monday on its own.

## 2026-11-13: no repository or person named in public prose

The brief says public material names no repository or person. The repository still did in a few places: the launch plans in docs/launch (quiet week candidates, community notes, the first push runbook), example PRs in the precision notes, and a few project names in LOG.md, design.md and the assessment.

Done in this batch: docs/launch is moved out of the public repository (the files now live in ~/Project AI Builder/testwitness/launch on your Mac), and the prose elsewhere describes cases by shape, not by name.

Still named, and your call: the corpus itself (corpus/entries, one folder per public pull request with its URL and a copy of its description) and a source line in nine fixture READMEs pointing at the public PR a case was modelled on. These are data and attribution rather than claims, and the corpus cannot be reproduced without its URLs.
Decided by Sajjad (13 Nov): the PR links stay for auditability. corpus/README.md says a finding is not a judgement of the PR or its authors, that skipping or removing a test is often correct, and that entries are removed on request.

## 2026-11-13: how to merge the port of 4 and 5 Nov work (PR "port day 4 afternoon")

Twelve commits, each a coherent topic that was verified on its own on 4 Nov, plus one fix for the portable pack:check. Splitting them into twelve PRs would mean twelve CI runs and a rebase chain.

Recommendation: merge it with "Rebase and merge" so the twelve commits stay separate in history (bisect and blame stay useful). Squash also works.
Default: one PR, commits kept.

## 2026-11-13: study pace

The study sampler accepts about 17 PRs per hour at GitHub's search rate limit from this workspace; 146 of 650 are sampled. Two options: let it run (about 30 more hours spread over the next days, resumable) or cut to 60 per agent plus 100 humans (400 in all).

Recommendation: keep the full design. Moving the run into a scheduled GitHub Actions workflow on the public repository would make it immune to workspace restarts; that needs your OK because it uses the repository's Actions minutes and a token with search access (the default GITHUB_TOKEN is enough for public search).
Default: full design, run from this workspace, resumed after every restart.

## 2026-11-13: real world trial without forks

The brief asks for runs on forks of 20 repositories. Creating forks is an outward action on your account. Replaying recent merged PRs locally with the CLI gives the same false positive, crash and runtime data, minus the PR comment rendering.

Recommendation: local replay now; forks only for the 3 to 5 quiet week candidates later, where the comment itself is what we test.
Default: local replay.

## 2026-11-13: A001, A009 and O002 ship at low by default

A replay of 300 recent merged PRs from 20 popular repositories found precision 0.04 on medium and high findings before the fixes in this batch and 0.42 after. On the larger corpus (347 entries) the held out precision on medium and high findings was 0.29 for A001, 0.00 for A009 and 0.00 for O002.

Recommendation: these three ship at low (shown in the report, never failing a check) until their measured precision improves; any repository can raise them with `rules: { A001: medium }`.
Default: done in this batch.

## 2026-11-13: what the agent hook blocks by default

Superseded by "v0.1 narrowed to four proven rules" above: the hook now blocks on A002, R003, R004, R005 and W006. The earlier list was the rules with true positives at high on the corpus and no wrongful block on the corpus or the 300 PR trial: A002, C001, C002, R004, R005, W003, plus W006 (the gate protecting itself). Deleted tests (R001, R002) are advice in the hook until their replay is clean; a maintainer can widen the list with `hook.blocking`.

Recommendation: keep the list derived by the replay test, which fails when the measurement and the list disagree.
Default: as above.

## 2026-11-13: V004 and ticked PR template boxes

A ticked "I have added tests" box counts as a claim only when the PR changes no test file. Treating ticked boxes as plain template text would remove six corpus true positives (PRs that tick the box and add no test).
Default: as above.
