# Launch study: how agent authored pull requests change their tests

This directory holds the scripts for the measurement described in section 7.5
of the spec. It measures how often testwitness rules fire on merged public pull
requests written by five coding agents, and on human authored pull requests
from the same repositories and period as a baseline.

## Data source

Public GitHub data only. Metadata comes from the REST search API
(`gh api search/issues` and `gh api search/repositories`); the GraphQL backed
`gh search prs` command and the `repos/...` endpoints are not reachable from the
collection environment, and neither are raw diff downloads. Diffs are computed
locally with git, the same way as the regression corpus (see
`corpus/README.md`): a commit only mirror of each repository
(`git fetch --filter=tree:0`) plus `refs/pull/<n>/head`, compared against the
merge base with the default branch (or with the first parent of the merge
commit when the PR was merged with one). Blobs are fetched on demand. Nothing is
posted, commented or starred, and no account is created anywhere.

## Sample

Inclusion criteria for every PR:

* merged, created between 1 July and 31 October 2026 (inclusive);
* repository with at least 100 stars at collection time;
* repository primary language TypeScript, Python or Java (this is the language
  of the PR in every table);
* 20 to 2,000 changed lines (additions plus deletions, from `git diff --numstat`);
* touches at least one test file according to the engine's own classifier
  (`packages/core/src/diff/classify.ts`), checked on the numstat paths when
  sampling and again on the rename aware manifest when fetching.

Cohorts and how they are identified:

| Cohort | Identification | Target |
|---|---|---|
| Claude Code | body contains "Generated with Claude Code" or a "Co-Authored-By: Claude" trailer | 100 |
| Copilot coding agent | author `copilot-swe-agent[bot]` (search: `author:app/copilot-swe-agent`) | 100 |
| Devin | author `devin-ai-integration[bot]` | 100 |
| Cursor | author `cursor[bot]` | 100 |
| Codex cloud | body links to `chatgpt.com/codex` | 100 |
| Human baseline | human account, same repositories and period as the agent sample, no assistant signal in author or body | 150 |

A PR that carries markers of more than one agent is excluded. Each agent's 100
is split as evenly as possible over the three languages (34, 33, 33). When a
language runs dry for an agent, that cell keeps what it has and the rest moves
to the other two languages, so Java cells are expected to be small for some
agents. The human baseline is split 50, 50, 50 over languages and drawn from
the repositories that appear in the agent sample, at most a few PRs per
repository. Agent PRs are capped at 3 per repository per agent so one busy
repository cannot dominate a cohort.

Search walks seven day windows of the period in a seeded random order, sorted
by creation date inside each window, and the items on each result page are
shuffled with the same seed before they are checked. Every rejected candidate
and the reason is kept in `rejected.jsonl`, so the flow from candidates to
sample can be reported.

## Method

`run.ts` runs the engine in diff only mode: no JUnit evidence, default
configuration (a repository's own `.testwitness.yml` is not honoured, so every
cohort is measured with the same rules), and the PR title and sanitised body
as PR text so V004 can check claims. The temporary repository approach is the
one in `corpus/runner/corpus.ts`. Rules that need test run evidence (E group,
V005) cannot fire in this mode.

`analyze.py` reports, with Wilson 95 percent score intervals:

* cell counts per cohort and language;
* share of PRs with at least one high finding, and with medium or high, per
  cohort, with the difference against the human baseline (Newcombe interval);
* prevalence of each rule per cohort and per cohort and language;
* the share of new tests flagged O001 (no assertion) or O002 (smoke oracle
  only) per cohort. The denominator is new tests those rules can judge. This is
  shown beside the reference values from the paper the launch post cites (80.2
  percent weak or no oracle overall; strong oracle share 67 percent for Claude
  Code and 18 percent for Codex), with the warning that the definitions differ.

## Ethics and what is published

* Public data only, read only collection, paced well below API limits (8
  seconds between search calls, never in parallel; 2 seconds between git
  fetches).
* Only aggregates are published: `tables.md`, `summary.md`, `figures/`,
  `precision.md` and `findings.jsonl` (rule, severity, label, cohort, language,
  a hash of the PR url and a SHA-256 of the test name; no test names, no paths,
  no urls).
* No repository or author is ever named or ranked, in tables, figures, the
  launch post or replies to it. `sample.jsonl`, `rejected.jsonl`,
  `results.csv`, `labels.csv`, `data/` and `cache/` stay local (see
  `.gitignore`).
* PR bodies are kept locally only, with mentions, HTML comments and sign off
  lines stripped as in `corpus/_tools/ingest.py`.
* Findings describe what a change does to a test, never why. Write about tests
  that were weakened or removed, not about intent.

## How to run end to end

```
pnpm study:sample                 # hours: search is paced at 8 s per call; rerun to resume
pnpm study:fetch                  # mirrors under /tmp/study-repos, data/<slug>/ like corpus entries
pnpm study:sample && pnpm study:fetch   # repeat if fetch excluded PRs, to top strata back up
pnpm study:run                    # engine on every fetched PR -> results.csv, findings.jsonl
pnpm study:analyze                # tables.md, summary.md, figures/*.png
python3 -I study/label-sheet.py   # 100 PRs (20 per agent, seeded) -> labels.csv for two labellers
python3 -I study/kappa.py         # after both labellers filled their column -> precision.md
```

Every script takes `--dir <path>` to work in another directory; the smoke test
used `--dir study/smoke --per-agent 2 --humans 2`. `sample.ts` also takes
`--per-agent`, `--humans`, `--seed`, `--per-repo` and `--max-calls`.
`run.ts --force` reruns the engine on PRs that already have a stored report.

## Limitations

* The detector was built by the people measuring with it. Rules were tuned on
  the corpus tuning split, not on this sample, but the choice of rules and
  severities is ours. Precision on this sample comes from the label set below,
  not from the corpus.
* Precision is estimated from a 100 PR label set (20 per agent) labelled by two
  people; with that many rows per rule the intervals for rare rules are wide,
  and a rule with few findings may have no precision estimate at all.
* The human baseline is contaminated by agent use we cannot see: a person can
  use an assistant without leaving a marker. The baseline is therefore "PRs
  with no visible agent marker", and differences against it are likely
  understated.
* Codex CLI and other local tools leave no reliable marker, so they cannot be
  identified; the Codex cohort is Codex cloud only. Claude Code PRs where the
  footer was removed are missed the same way.
* Java cells are small for several agents, so per language estimates for Java
  have wide intervals and should not be compared across agents.
* Diff only mode: whether changed tests actually ran is not measured.
* Stars are read at collection time, not at PR creation. Repository primary
  language stands in for the PR's language.
* Several findings in one PR are not independent, and the new test oracle
  shares treat tests as independent, so those intervals are too narrow.
* Search results are capped at 1,000 per query and ordered by creation date
  within each window, so the sample is a seeded draw from what search returns,
  not a simple random sample of all qualifying PRs.
