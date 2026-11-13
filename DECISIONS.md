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
