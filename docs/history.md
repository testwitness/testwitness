# Run history

With a history of earlier runs, testwitness grades some findings by what the test did before. Skipping a test that kept failing is the strongest signal the tool has: the pull request makes a red build green without fixing anything. Skipping a test that is known to be flaky, with an issue to track it, is a reasonable thing to do. The diff alone cannot tell these apart. The history can, by counting. Nothing is learned, nothing is estimated, and the same history and the same diff always give the same report.

## What changes

Exactly three things. Every other rule and every other severity is the same with or without history.

| Finding | Condition in the history | Result |
|---|---|---|
| R001 (test deleted), R003 (test skipped), R004 (expected failure) | the test failed or errored in at least 2 of its last 5 recorded runs | high, label **hides failure**, the message ends with the count, for example `failed in 3 of the last 5 runs` |
| R003 whose skip reason references an issue (label tracked without history) | the test is flaky: it passed and failed within the window of 20 runs, or reran in at least 2 of them | severity unchanged, label **flaky in history**, the message ends with the counts, for example `flaky in history: passed in 12 and failed in 1 of the last 13 runs, reran in 2` |
| V003 (changed test did not run) | the test has a record in every one of the last 5 runs of the history | high, label **ran before, not now**, the message ends with `it ran in each of the last 5 runs` |

Precisely:

- **Recorded run** of a test: a run of the history in which the test key has a record of any status (passed, flaky, skipped, failed, errored). "Its last 5 recorded runs" are the last 5 such runs, so a test that only runs nightly is not diluted by the runs that did not include it. A test with only 2 recorded runs that both failed counts as 2 of 2.
- **Failed** means a failure or an error, including one that persisted through reruns. A test that failed and then passed on a rerun in the same run (Surefire `flakyFailure`, the same test failed in one result file and passed in another) is flaky in that run, not failed.
- **Flaky** means: at least one passed (or flaky) run and at least one failed run in the window, or at least 2 runs with reruns (flaky, or failed after reruns).
- When a skip qualifies for both, hides failure wins: a test that failed in 2 of its last 5 runs is graded as a hidden failure even when it is also flaky and the skip has an issue.
- A tracked skip of a test that kept failing is raised as well: the issue documents the failure, it does not make the test pass, and the pull request still turns a failing suite green.
- A skip of a flaky test **without** an issue reference is unchanged. A flaky history excuses nothing on its own.
- V003 for a test the history has never seen, or that is missing from any of the last 5 runs, keeps its severity. A history with fewer than 5 runs never raises V003.
- Findings the rule already graded low because the test still runs somewhere, or only partly stopped running, are left alone: labels moved, parameterised, rewritten, replaced, refactored, production removed, conditional, one case and partial results. The history says the test was failing; it does not say that this change hides it.
- The history adjustment happens before the configured severity shift, so a severity set for the rule in `.testwitness.yml` still shifts the result by the same number of steps, and an acknowledgement still matches by fingerprint (the fingerprint does not include severity, label or message).

Matching uses the same candidate keys as V003 (`inventoryKeys`): the test's path and qualified name give the normalised `classKey::nameKey` keys the JUnit reader builds for each producer, and the first key the history knows is used.

## The history document

A small JSON file, `schemaVersion: "1"`, described by [`docs/history.schema.json`](https://github.com/testwitness/testwitness/blob/main/docs/history.schema.json) and published at `https://testwitness.github.io/testwitness/history.schema.json`.

```json
{
  "$schema": "https://testwitness.github.io/testwitness/history.schema.json",
  "schemaVersion": "1",
  "window": 20,
  "runs": [
    {"id":"9412","date":"2026-11-03","total":6,"passed":4,"failed":1,"errored":0,"skipped":1,"flaky":0},
    {"id":"9431","date":"2026-11-04","total":6,"passed":4,"failed":1,"errored":0,"skipped":1,"flaky":0}
  ],
  "tests": {
    "stacktest::failsonpurpose": "FF",
    "stacktest::pushincreasessize": "PP"
  }
}
```

- `runs`, oldest first: the run id (the workflow run id in the Action, with `.<attempt>` after a re-run; `--run-id` or `local-<head sha>` in the CLI), the UTC date and the totals of that run.
- `tests`: per normalised test key, one character per run, aligned with `runs`. `P` passed, `K` flaky (failed, then passed on a rerun), `S` skipped, `F` failed, `f` failed after reruns, `E` error, `e` error after reruns, `-` no record in that run.
- Keys only. No source code, no file paths, no test bodies, no pull request text, no names of people.

Merging the current run into the history:

- One column per run. A run id already in the document (a re-run of the same workflow run) replaces that column instead of adding one.
- A key that repeats within one run keeps its worst outcome, as the JUnit reader does.
- The window keeps the last 20 runs. When a 21st is added the oldest rolls off, and a key with no record left in the window is removed.
- Size cap 5 MB. When the serialised document is larger, the oldest runs roll off until it fits. The newest run is never dropped; if it alone is over the cap (a suite of well over 100,000 tests), keys are kept in sorted order until the cap, `truncated: true` is set and the report says so.
- A run that read no JUnit XML is not recorded: the history passes through unchanged.
- The document is written with sorted keys, one test per line, so it diffs well and the same inputs give the same bytes.

A history file that is missing, over 10 MB, not JSON, of another schema version, or misaligned is ignored with a note in the report; the run goes on without history.

## CLI

```
testwitness check --junit "**/junit*.xml" --history history.json --history-out history.json
```

`--history <file>` reads a history, `--history-out <file>` writes the history with this run merged in, `--run-id <id>` names this run (default `GITHUB_RUN_ID`, then `local-<head sha>`). There is no default location and no hidden directory: without `--history` severities do not depend on earlier runs, and without `--history-out` nothing is written. Where the file lives between runs (a CI cache, an artifact, a branch) is up to the pipeline.

## GitHub Action

```yaml
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  pull-requests: write
  actions: read # read the history artifact of the base branch
steps:
  - uses: testwitness/testwitness@v0
    with:
      junit: "**/junit*.xml"
      history_artifact: testwitness-history # the default
```

- **On a push to the default branch** the Action merges the run into the history it downloaded and uploads it as the artifact `history_artifact` (default `testwitness-history`), kept 90 days. `history_write: true` uploads on any event. The diff on such a push is empty, so the push run only records.
- **On pull_request** the Action finds the latest successful run of the same workflow on the base branch that has the artifact (it looks at the last 5 successful runs), downloads it through the GitHub REST API with the job token and grades with it. It never uploads from a pull request unless `history_write: true`, so a pull request cannot write the history the next pull request reads. It only reads the artifact of runs started by `push`, `schedule` or `workflow_dispatch` in this repository: a pull request run, from a fork whose branch is also named like the base branch or with an edited workflow file, is never read, so a history uploaded from a pull request is never used.
- `history: <path>` reads a local file instead of downloading.
- Every step fails soft with one info line in the log: no token, no `actions: read` permission, no earlier successful run, an expired artifact, or no artifact runtime token for the upload. The check then runs as it does without history.
- **Fork pull requests** run with a read only token. Whether it can read the base repository's artifacts depends on the repository's settings for fork workflows, so fork pull requests may run without history.
- The updated history is always written next to the reports as `testwitness-history.json` (output `history`), whether or not it is uploaded.

The engine itself makes no network calls. The only network traffic is the Action's calls to the GitHub REST API for the comment, the acknowledgements and the history artifact, with the job token, and the artifact upload through the runner's artifact service.

## Why these three and no more

The roadmap (section 4.5 of the assessment) also describes relative assertion density per file. It needs per file aggregates of assertions that the JUnit XML does not carry, so it is not part of history version 1. Each of the three adjustments above can be checked by reading two lines of the history document, which is the bar every future adjustment has to meet.
