# Decisions for Sajjad

Each entry: the decision, my recommendation, and the reversible default I am proceeding with. Newest first.

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

The hook blocks only on rules with true positives at high on the corpus and no wrongful block on the corpus or the 300 PR trial: A002, C001, C002, R004, R005, W003, plus W006 (the gate protecting itself). Deleted tests (R001, R002) are advice in the hook until their replay is clean; a maintainer can widen the list with `hook.blocking`.

Recommendation: keep the list derived by the replay test, which fails when the measurement and the list disagree.
Default: as above.

## 2026-11-13: V004 and ticked PR template boxes

A ticked "I have added tests" box counts as a claim only when the PR changes no test file. Treating ticked boxes as plain template text would remove six corpus true positives (PRs that tick the box and add no test).
Default: as above.
