# testwitness regression corpus

Real merged pull requests from public GitHub repositories, collected so the
rules can be tuned against honest test refactors (false positive controls) and
checked against a few clearly weakened test changes (true positives).

## Method

1. Candidate PRs were found with the GitHub search API (`gh api search/issues`
   with `is:pr is:merged` and title keywords such as "parametrize",
   "move tests", "test helper", "update snapshot", "skip on windows",
   "remove deprecated", "disable flaky test") inside repositories with at least
   100 stars.
2. Repository stars, licence and language came from `gh api search/repositories`.
3. The diff was produced locally with git, never edited by hand: a commit only
   mirror of the repository (`git fetch --filter=tree:0`) plus
   `refs/pull/<n>/head`, then `git diff <base> <head>` where `<base>` is the merge
   base between the PR head and the default branch (for PRs merged with a merge
   commit, the merge base between the merge commit's first parent and the head).
   This matches the three dot compare GitHub shows on the PR page. git rename
   detection is on, so pure moves appear as `rename from`/`rename to` headers.
4. PRs over 2,000 changed lines were skipped. Each entry was read and labelled
   by hand.
5. Read only: no comments, no sign ups, nothing was posted anywhere.

## Licence policy

Only repositories whose licence SPDX id is one of MIT, Apache-2.0,
BSD-2-Clause, BSD-3-Clause or ISC are included. The diff in each entry is a
copy of the upstream change and remains under that repository's licence, which
is recorded in `pr.json` as `license`. Only the PR title is reproduced, never
the PR body. No author or reviewer names are recorded in `pr.json`,
`expected.json`, `NOTES.md` or `index.json` (the raw diff may of course contain
whatever the upstream change contained).

## Layout

```
corpus/
  README.md
  index.json              all pr.json records in one array
  entries/<slug>/
    pr.json               url, repo, number, title, merged_at, stars, license,
                          language, category, split, base_sha, head_sha,
                          files_changed, additions, deletions
    pr.diff               raw diff, unmodified
    expected.json         findings a correct tool should emit: list of
                          {ruleId, subject?, verdict: "tp"|"fp", reason?}
                          ([] for honest refactors)
    NOTES.md              what the PR did, why it is honest or weakened,
                          which rule it stresses
  _tools/                 the collection scripts (search.sh, ingest.py,
                          label.py, verify.py)
```

Slug is `<owner>-<repo>-<number>` in lower case.

## Categories

- `move`: tests moved or renamed between files or classes.
- `parametrize`: several tests folded into one parameterised test.
- `helper`: assertions extracted into helper functions.
- `snapshot`: snapshots updated alongside the component that renders them.
- `deps`: dependency bumps touching lockfiles and snapshots.
- `skip`: a conditional skip added for a platform or optional dependency with a reason.
- `deleted`: a test deleted because the feature it covered was removed.
- `tp`: clearly weakened tests (true positives), kept separate from the controls.

## Rule ids used in expected.json

The spec's rule catalogue could not be read from the session that built this
corpus, so the ids below follow the rule group letters in
`packages/core/src/types.ts` and must be reconciled with spec section 1 when
the rules land. `S001` means an unconditional skip or disable without a tracked
reason, `X001` a non strict xfail added. Honest entries carry an empty list.

## Tuning and held out split

Every entry is assigned by the parity of the SHA-256 of its PR url
(`https://github.com/<owner>/<repo>/pull/<n>`), interpreted as an integer:
even goes to `tuning`, odd goes to `heldout`. The split is stored in `pr.json`
and must never be changed by hand. Rules may be tuned on `tuning` entries only;
`heldout` entries are for the final false positive rate.

## Adding an entry

1. Check the repository: `gh api -X GET search/repositories -f q=repo:<owner>/<repo>`
   must show at least 100 stars and a licence from the list above.
2. Run `python3 -I corpus/_tools/ingest.py <owner>/<repo> <number> <category>`.
   It refuses unmerged PRs, PRs over 2,000 changed lines and bad licences, and
   writes `pr.json` and `pr.diff`.
3. Read the diff and write `expected.json` and `NOTES.md` by hand (two to five
   sentences, no names).
4. Run `python3 -I corpus/_tools/verify.py` to rebuild `index.json` and check
   the entry.
