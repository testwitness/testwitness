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
    files/manifest.json   every changed file: {path, status, oldPath?} with
                          status added, modified, deleted or renamed, from
                          git diff --name-status --find-renames
    files/base/<path>     full base version of changed test files, snapshots,
    files/head/<path>     runner configs and CI workflows (any size) and of
                          changed production source files under 50 KB.
                          Deleted files exist only under base/, added files
                          only under head/
  _tools/                 the collection scripts (search.sh, ingest.py,
                          files.py, label.py, expected.py, verify.py)
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
- `tp`: the first five clearly weakened tests (true positives), kept separate from the controls.
- `R001`, `R002`, `R003`, `R004`, `R005`, `R010`, `A001`, `A002`, `O002`, `W003`, `V004`: true positive entries collected per rule; the category is the rule id the entry was collected for and every finding in expected.json has verdict `tp`. Severities follow the rule defaults (R002 high, R010 low) and the catalogue notes (R004 medium when strict with an issue reference).

A `pr-body.md` file (PR body with mentions and sign off lines stripped) is stored only for V004 entries. The corpus runner passes it to the engine as the PR body when present; every other entry is checked against the title only.

## Rule ids used in expected.json

Ids follow the spec catalogue: R001 deleted test (medium; low with label
`moved` or `parameterised`), R002 deleted test file, R003 skip or disable added
(medium; low with label `tracked` when the reason references an issue, low with
label `conditional` for a platform or optional dependency condition), R004
xfail or expectedFailure added (high; medium when strict with an issue
reference), A001 assertion removed, A002 assertion loosened, A009 tautology,
O001 new test without assertion, O002 smoke oracle only, O006 new test file with
no tests.

Each finding is `{ruleId, severity, subject?, label?, verdict, reason?}`.
`verdict` says what the finding points at: `tp` when the test really was
weakened, `fp` when the finding is a benign low severity signal the tool is
still expected to emit (a moved test gives R001 low `moved`, a parametrised fold
gives R001 low `parameterised`, a conditional skip gives R003 low
`conditional`). Anything the tool emits above low on an honest entry is a false
positive. Subjects are the test names deleted in the diff that do not reappear
under the same name; `deleted` entries carry an empty list because the
production code was removed in the same PR and the spec credits that.

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
3. Run `python3 -I corpus/_tools/files.py <slug>` to populate `files/`.
4. Read the diff and write `expected.json` and `NOTES.md` by hand (two to five
   sentences, no names).
5. Run `python3 -I corpus/_tools/verify.py` to rebuild `index.json` and check
   the entry.
