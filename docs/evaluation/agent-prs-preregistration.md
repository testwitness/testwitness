<!-- Published copy. The original was committed on 15 November 2026 at commit f0060d89fcbeac7c404b53a2961003e7dea49166 of the local measurement repository, sha256 d2bf8871d11b87c7a84fe9ba342a92002bb69640a4b65f8429ec76d409171dd3, before any search, collection or run. Paths in it are relative to that measurement folder. -->

# Preregistration: testwitness on real agent pull requests

Written 15 November 2026 (UTC) and committed before any repository was searched for this study, before any pull request was collected, and before the tool was run on any pull request of it. Any change after the commit is a deviation, written in `DEVIATIONS.md` at the time with its reason. Nothing about the tool's output can remove a repository or a pull request from a set.

## 1. Questions

1. Precision: of the findings testwitness reports at medium or high on merged agent pull requests, what share are real (section 6)? Per rule, per agent, per language, with Wilson 95 percent intervals.
2. Recall in the wild: of the real weakenings of the four shipped shapes (R003 newly skipped, R004 expected failure, R005 focused test, A002 assertion loosened) that occur in those pull requests, what share does it report at medium or high?
3. The same two quantities on a matched human baseline from the same repositories and period.
4. Uncapped behaviour: every rule judged at the severity it gives before the v0.1 cap, so a capped rule (R001 above all) can earn its way back (section 9).

## 2. Tool under test

- testwitness 0.1.1 exactly as published on npm: `testwitness-0.1.1.tgz`, sha256 `8d538f9b19528be36eded8e8a6cdec7597f921c01d0bae4b24880f573af61e5c`; `dist/cli.js` sha256 `240931c9e3221e52817c3a6f75a55e6034d7754f44c67717f0f55034b3d59515`. Unpacked in `tool/package`, dependencies installed with `npm install --omit=dev --ignore-scripts` there.
- Later builds made while fixing false shapes (section 9) are identified by commit and `dist/cli.js` sha256 in `LOG.md` before they are run on anything.
- Command, per pull request, with the repository checked out at the head:

      node tool/package/bin/testwitness.js check --cwd <clone> --base <mergebase> --head <head> --format json --out <file> --pr-title <title> --pr-body-file <body> --author <login> --author-type <type>

  Default config; a `.testwitness.yml` in the measured repository is honoured, as in production. No results, timeout 900 seconds; a crash or timeout stays in the counts with no findings. Every JSON report is kept, and the full `git diff -M <mergebase> <head>` of every pull request.

## 3. Sampling

### 3.1 Agents and how a pull request is attributed

A pull request is an agent pull request when exactly one agent below is identified. Search finds candidates; attribution is then confirmed on the fetched data with the patterns given (case insensitive). A candidate with markers of two or more agents is excluded and logged.

| Agent | Search used to find candidates | Confirmation |
|---|---|---|
| GitHub Copilot coding agent | `author:app/copilot-swe-agent` | author is that app |
| Devin | `author:app/devin-ai-integration` | author is that app |
| Cursor | `author:app/cursor`; in a selected repository also `"cursor.com" in:body` | author is that app, or body or a commit matches `cursor\.com/(background-agent\|agents)` or a `Co-authored-by: Cursor` trailer |
| Jules | `author:app/google-labs-jules` | author is that app |
| Claude Code | `author:app/claude`; in a selected repository also `"Claude Code" in:body` | author is that app, or body or a commit matches `Generated with \[?Claude Code`, a `Co-Authored-By: Claude` trailer or a `Claude-Session:` trailer |
| Codex | `"chatgpt.com/codex" in:body` | body or a commit matches `chatgpt\.com/codex` |
| OpenHands | `author:openhands-agent` | author is that account, or a commit trailer `Co-authored-by: openhands` |

Search full text matching is loose, so a candidate found by body search and not confirmed by its pattern is rejected with the reason `unconfirmed`.

Human baseline: author `type` is `User`, the login is not a bot (no `[bot]` suffix, not on the list above), and no agent pattern above matches the title, the body or any commit message of the pull request.

### 3.2 Period and pull request eligibility

- Merged between 2026-06-01T00:00:00Z and 2026-11-14T23:59:59Z.
- Touches at least one test file by the engine's own classifier (the `TEST_RE` of the earlier measurements, `fresh20b/scripts/select_run.py`, copied unchanged into `scripts/`).
- 1 to 3,000 changed lines (additions plus deletions, `git diff --numstat` against the merge base).
- Head fetched from `refs/pull/N/head`; base computed with `heuristic_base` copied unchanged from `fresh20b/scripts/select_run.py`, then `git merge-base`. A pull request whose head cannot be fetched, whose base cannot be computed, or whose merge base is a root commit is rejected and logged.

### 3.3 Repository frame

1. Discovery. For every app or account search in 3.1 and for the Codex body search: every 3 day window of the period, merged pull requests, sorted by created date descending, pages 1 to 10 (search returns at most 1,000 per query). Copilot and Devin windows are 12 hours, because their volume exceeds 1,000 per 3 days. Every repository seen is a candidate. The raw pages are saved.
2. Batch metadata through `search/repositories` with several `repo:` qualifiers per call: stars, primary language, fork, archived, licence, size.
3. Eligible repository: public, not a fork, not archived; at least 200 stars at collection time; primary language TypeScript, JavaScript, Python or Java (TypeScript and JavaScript form one stratum); an SPDX licence other than `NOASSERTION`; size at most 2,000,000 KB; not on `meta/exclusions.txt` (sha256 `2bc7a3c49ae5dc417a42cf36b6ea12f21a4c92944f23d02710ed2ec4fbfd297c`: the corpus repositories, the old trial, both earlier untuned replays and every candidate they examined); and, after a commit only mirror is fetched, at least 20 files matching `TEST_RE` for the stratum's language at the default branch head.
4. Agent volume. For each eligible repository, the exact number of merged agent pull requests in the period per agent (search `total_count`, then confirmation of the collected ones), and the number of all merged pull requests in the period.
5. Selection. A repository needs at least 8 confirmed agent pull requests that pass 3.2. Eligible repositories are ordered by sha256 of `seed + owner/repo` (seed in 3.5) within each language stratum and taken in that order until the targets in 3.4 are met or the stratum is exhausted. One owner contributes at most 3 repositories.

### 3.4 Targets

- At least 1,000 agent pull requests from at least 50 repositories over the three language strata; target 60 repositories, 20 per stratum, a stratum that runs dry hands its shortfall to the other two.
- Per repository: all agent pull requests that pass 3.2, at most 30, the most recently merged first. Per agent per repository at most 15, so one agent cannot fill a repository.
- Human baseline: per repository, the most recently merged human pull requests that pass 3.2, as many as that repository's agent pull requests, at most 20.

### 3.5 Seed

The seed is the sha256 of the sorted list of eligible repositories after step 3.3.4, written to `LOG.md` before step 3.3.5 runs. No one can choose it.

## 4. Sets

Splitting is by repository, so no repository's patterns cross from tuning into measurement. Within each language stratum, repositories are ordered by sha256 of `seed + "split" + owner/repo`; the first 30 percent (rounded) go to **tune**, the next 30 percent to **validate**, the rest (about 40 percent) to **test**. A repository's human pull requests follow it.

- tune: may be read freely and used to change rules.
- validate: measured after each round of fixes; never used to decide what a fix looks like, only whether it is good enough.
- test: sealed. Its manifest (repository list and pull request numbers) is written and its sha256 recorded in `LOG.md`. Its diffs are fetched only as far as section 3 requires and are not opened by me or any judge, and the tool is not run on it, until an opening. It is opened once per release candidate (section 9), each opening recorded in `LOG.md` with the build, the date and the result, and never used to change a rule.

Real weakenings found by the search of section 8 in test repositories are not used for tuning and not added to the corpus until after the last opening.

## 5. What is judged

- **Findings**: every finding with reported severity medium or high (shipped behaviour), and separately every finding whose `uncappedSeverity` is medium or high (uncapped behaviour). Low findings are not judged.
- **Misses** (recall in the wild), two passes per set measured:
  1. A lexical screen over every pull request of the set, fixed here: in test files, an added line matching a skip, todo, disable, expected failure or focus marker of the stratum's frameworks (the marker lists of the engine's language front ends at 0.1.1, written out in `scripts/screen.py` before the first run), or a removed assertion line in a test whose head version has an assertion on the same subject. Every screen hit without a medium or high finding of the matching rule goes to the judges as a candidate miss.
  2. A random sample, seeded, of 60 pull requests per set with no medium or high finding of the four shipped rules, each read in full by both judges for any real weakening of the four shapes.

## 6. Labelling guide

The rubric is the one of the second untuned replay (`fresh20b/PREREGISTRATION.md`, "Judging rubric", G1 to G6 and the per rule entries), copied into `JUDGING.md` unchanged except for the tool version. In short:

- A finding is true when the diff shows the event the rule defines and none of the rule's own documented false positive controls describes the case. When in doubt, false.
- The message must name the right thing; a real weakening reported as a different event is false.
- A correct observation is true even when the change was deliberate and disclosed in the pull request text; each true finding is tagged `disclosed` or `undisclosed`.

**What counts as a real weakening** (for misses and for section 8): a test that ran in the base checks strictly less in the head, by one of the four shapes, with nothing else in the pull request restoring the check: (R003) a skip, todo, fixme or disable marker added unconditionally or on a constant condition to a test that ran; (R004) an expected failure marker added to a test that was expected to pass; (R005) a focus marker added to a real test; (A002) the same subject checked by a strictly weaker assertion with no stronger check added. Removing a test together with the code it tested, or moving it, is not a weakening.

## 7. Judges

Two judges label every finding and every candidate miss, independently: separate agents of different models, each given only a blind packet (the item, the diff of its file, the path of the whole diff, the pull request title and body, `docs/rules.md` of the build, and `JUDGING.md`). Neither sees the other's labels, my labels, the tool's internals or this folder's history. Agreement is reported as raw agreement and Cohen's kappa.

**Disagreement always resolves against the tool**: a finding the judges disagree on counts as false; a candidate miss they disagree on counts as a real miss. I check every label that reaches a report against the diff myself; I can only turn a true into a false or a non miss into a miss, never the other way.

## 8. Real weakening in the wild (enriched, reported separately)

A search of agent pull requests outside the test repositories for the four shapes and for deleted tests, where a later commit, a review comment or a revert shows the change was wrong. Each confirmed case is kept with its dated evidence link, run through the tool, and labelled caught or missed. These cases are chosen because they are weakenings, so they say nothing about precision and are never pooled with sections 5 and 10; they show what a real catch looks like and feed the recall bug list. Target at least 30 confirmed cases over the four shipped rules.

## 9. Fixing false shapes and the release ladder

- Fixes are designed on the tune set only.
- After each round, the build is run on the validate set and judged by section 5 to 7.
- The test set is opened only when validate precision on medium and high findings (shipped behaviour of that build) is at least 0.9 with at least 20 findings. That build is the release candidate. The test result is published whatever it is.
- A capped rule, R001 above all, returns to medium only when it passes the same ladder on its own uncapped findings: validate precision at least 0.9 with at least 20 findings, then the test set.
- If the bar is never met, the report says so and no test number is published as a claim.

## 10. Reporting

- Precision with Wilson 95 percent intervals: overall, per rule, per agent, per language, agent versus human.
- Recall per shipped rule: caught over caught plus misses (screen misses plus misses from the random sample, the latter also scaled to the set with its interval), Wilson 95 percent.
- Findings per 100 pull requests, agent and human.
- Every count that goes public is aggregate only: no repository, person or pull request named. Links stay in the local data for audit.

## 11. Pacing and resumption

Collection respects GitHub's search limit (at most 28 calls a minute) and saves every response. All state lives in `state.json` and the `meta/` and `data/` folders, so a pause loses nothing. Disk housekeeping (removing working trees or whole clones of finished repositories, keeping results and diffs) changes no selection or result.
