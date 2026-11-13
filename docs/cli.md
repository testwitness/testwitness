# CLI

The CLI is the npm package `testwitness`. It needs Node 20 or newer and ships as a single bundle with its tree-sitter grammars, so it has no runtime dependencies.

```bash
npx testwitness check [options]   # run without installing
npm i -g testwitness              # or install once
testwitness check [options]
testwitness --version
```

Run it from the repository root (or pass `--cwd`). It needs the git history for both refs, so in CI fetch with full depth (for example `fetch-depth: 0` on `actions/checkout`).

On GitHub, prefer the Action, which wraps the same engine and adds the PR comment and annotations:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
- uses: testwitness/testwitness@v0
  with:
    results: "**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml"
```

| Option | Meaning | Default |
|---|---|---|
| `--base <ref>` | base ref; the merge base with head is used. A ref that does not name a commit fails with exit 2 and names the default branch. When the head is already contained in the base (the default branch itself, or a PR merged with a merge commit) there is nothing to compare: the state is `unreadable` and the report says so in `notes` | the default branch, from `origin/HEAD` (then `origin/main`, `origin/master`, `main`, `master`) |
| `--head <ref>` | head ref | `HEAD` |
| `--worktree` | compare the merge base with the working tree (staged, unstaged and untracked files that are not ignored) instead of the head commit; the findings and fingerprints are the ones the commit check gives once the change is committed, and nothing is written into the repository | off |
| `--results <globs>` | comma separated globs of test results: JUnit XML (recommended), TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright, told apart by content ([evidence](./evidence)) | from config `results.head` |
| `--junit <globs>` | older name of `--results`, used when `--results` is not given | |
| `--diff-only` | check the diff and the PR text only: read no test results, skip V005, and grade the state on the diff and claim rules alone (`pass` or `review`) | off |
| `--coverage <globs>` | comma separated globs of lcov, Cobertura or JaCoCo XML coverage reports of the head run (enables V008) | from config `coverage.paths` |
| `--mutation <globs>` | comma separated globs of Stryker JSON or PIT mutations.xml reports from the opt in mutation job (enables M001 and M002 and measures O001 and O002; see [mutation on request](./mutation-on-request)) | from config `mutation.paths` |
| `--config <path>` | `.testwitness.yml` path | base ref, then working tree |
| `--format <fmt>` | `markdown`, `json` or `both` | `markdown` |
| `--out <path>` | write to a file instead of stdout | |
| `--mode <mode>` | `report`, `require-ack`, `strict` | from config |
| `--fail-on <sev>` | `high`, `medium`, `low` | from config |
| `--pr-title <t>`, `--pr-body-file <f>` | PR text for claim checks | |
| `--author <login>`, `--author-type <type>` | PR author and account type, shown in provenance | |
| `--history <file>` | run history JSON of earlier runs; R001, R003, R004 and V003 then grade by what the test did before ([run history](./history)) | none |
| `--history-out <file>` | write the run history with this run's results merged in | none |
| `--run-id <id>` | id of this run in the history | `GITHUB_RUN_ID`, then `local-<head sha>` |
| `--follow-symlinks` | follow symbolic links in the results, coverage, mutation and history paths, for Bazel style layouts ([configuration](./configuration#symbolic-links-in-report-paths)) | config `paths.followSymlinks`, off |
| `--cwd <dir>` | repository directory | current |
| `-q, --quiet` | no progress on stderr | |

`testwitness rules` lists the built in rules.

## Running it locally

**From source, before the package is published.** Clone this repository, then run `pnpm install --frozen-lockfile` and `pnpm bundle:cli`. The CLI is then `node packages/cli/bin/testwitness.js`, with the same options as `testwitness`.

**Checking an existing pull request.** Fetch its head and check it out, because the helper index reads helper files from the working tree, not from `--head`:

```bash
git fetch origin pull/123/head:pr-123
git checkout --detach pr-123
testwitness check --base origin/main --head pr-123 --diff-only
```

Use the branch the pull request targets as `--base` (a backport or release branch is not `main`), or the CLI compares far more than the pull request changed. Once the pull request is merged with a merge commit, its head is already inside that branch and there is nothing to compare; use the first parent of the merge commit instead (`--base <merge commit>^1`). The CLI says "Nothing to compare" with the state `unreadable` when that happens, never `pass`.

**What `unreadable` means without results.** Without test results the diff rules still run, but nothing confirms which tests ran, so the state reads `unreadable` and V005 asks for a reporter. That is expected on a laptop. Pass `--diff-only` to say you only want the diff and claim rules: no results are searched for, V005 is skipped and the state is `pass` or `review`.

`testwitness mutate-plan --base <ref> --head <ref> [--format json|shell] [--out <file>] [--cwd <dir>]` prints the production files the PR changed and the settings that mutate only them: StrykerJS `--mutate` line ranges with `--incremental`, and PIT `targetClasses` and `targetTests`. It reads git and runs nothing. The shell format is single quoted variable assignments for a workflow to source. See [mutation on request](./mutation-on-request).

`testwitness hook --agent claude|cursor|codex|git [--base <ref>] [--timeout <seconds>] [--results <globs>] [--cwd <dir>]` is the [agent guard](./agent-guard). It reads the agent's hook event JSON on stdin (for `git`, the pre-push lines), checks the working tree when the event is a `git commit`, a `git push` or the end of a turn, and answers in that agent's blocking format. It blocks on open high findings of the rules on its blocking list (a small proven set by default, `hook.blocking` in the base config), at most twice per finding and session, and allows the action with a note when it crashes or runs past the timeout (20 seconds, or `hook.timeout` in the base config). Configuration is read from the merge base only. Exit code 0, except `--agent git`, which exits 1 to refuse a push.

`testwitness init --agent claude|cursor|codex|git [--command <cmd>] [--force] [--cwd <dir>]` writes the hook config for that agent and nothing else: `.claude/settings.json`, `.cursor/hooks.json`, `.codex/hooks.json`, or `pre-push` in the git hooks directory. It merges into an existing file, prints what it wrote and changes nothing on a second run. `--force` replaces a different existing pre-push hook. Exit codes: `0` written or unchanged, `1` refused (a different pre-push hook exists), `2` the existing config could not be read.

`testwitness mcp` starts a read only MCP server on stdio so coding agents can run the check and look up rules; see [MCP server for agents](./mcp).

The JSON report (`--format json`) follows the JSON Schema in [`docs/report.schema.json`](https://github.com/testwitness/testwitness/blob/main/docs/report.schema.json), published at `https://testwitness.github.io/testwitness/report.schema.json`, and carries `schemaVersion: "1"`.

Exit codes: `0` pass, or any result in `report` mode; `1` review needed under `require-ack` or `strict`; `2` config or git error; `3` no test results under `strict` with `require_evidence`.

The grammars and queries are read from `assets` next to the bundle. Set `TESTWITNESS_ASSET_DIR` to load them from another directory.

GitLab CI:

```yaml
testwitness:
  stage: test
  image: node:20
  script:
    - npx testwitness check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --head HEAD --results "**/junit*.xml" --format markdown --out testwitness.md
  artifacts:
    paths: [testwitness.md]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```
