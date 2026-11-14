# CLI

The CLI is the npm package `testwitness`. It needs Node 20 or newer and ships as a single bundle with its tree-sitter grammars, so it has no runtime dependencies. Supported on Linux and macOS. Windows is experimental in v0.1 and tracked in [an issue](https://github.com/testwitness/testwitness/issues?q=is%3Aissue+windows+support).

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
| `--config <path>` | `.testwitness.yml` path, read from disk as given | the merge base; without a config there, a local uncommitted `.testwitness.yml` (never one the change being checked adds) |
| `--format <fmt>` | `text`, `markdown`, `json` or `both` | `text` when stdout is a terminal, `markdown` when it is a pipe or with `--out` |
| `--out <path>` | write to a file instead of stdout | |
| `--mode <mode>` | `report`, `require-ack`, `strict` | from config |
| `--fail-on <sev>` | `high`, `medium`, `low` | from config |
| `--pr-title <t>`, `--pr-body-file <f>` | PR text for claim checks | |
| `--author <login>`, `--author-type <type>` | PR author and account type, shown in provenance | |
| `--follow-symlinks` | follow symbolic links in the results paths, for Bazel style layouts ([configuration](./configuration#symbolic-links-in-report-paths)) | config `paths.followSymlinks`, off |
| `--pr <url>` | trial run on a public pull request, `https://github.com/<owner>/<repo>/pull/<n>` (a trailing `/files` and the like is fine): fetches it with git, then checks it with `--diff-only`. Not with `--base`, `--head`, `--worktree`, `--results` or `--junit` ([trying it on a pull request](#trying-it-on-a-pull-request)) | |
| `--cwd <dir>` | repository directory | current |
| `-q, --quiet` | no progress on stderr | |

`--coverage`, `--mutation`, `--history`, `--history-out`, `--run-id` and the `mutate-plan` command are not in v0.1; the CLI refuses them as unknown options.

Findings of rules that are not proven yet are reported at low (see [configuration](./configuration#proven-rules-and-the-cap-at-low)); in `--format json` each such finding keeps the rule's own severity in `uncappedSeverity`.

The `text` format is for a person at a terminal: findings sorted high first, each with its file and line, the message and the text before and after, then one summary line. It is coloured unless `NO_COLOR` is set or `TERM` is `dumb`, and control characters from test names or PR text are shown as a placeholder so they cannot drive the terminal. Scripts and CI logs keep getting markdown, the same text as the PR comment, because a pipe is not a terminal.

`testwitness rules` lists the built in rules.

## Running it locally

**From source, before the package is published.** Clone this repository, then run `pnpm install --frozen-lockfile` and `pnpm bundle:cli`. The CLI is then `node packages/cli/bin/testwitness.js`, with the same options as `testwitness`.

### Trying it on a pull request

```bash
npx testwitness check --pr https://github.com/<owner>/<repo>/pull/<n>
```

Nothing to set up and no token. It works on public repositories only.

* When the current directory is a clone of that repository (its `origin` is the same GitHub repository), the pull request head and its base branch are fetched into `refs/testwitness/pr/<n>/head` and `refs/testwitness/pr/<n>/base`. Your branches, working tree and `FETCH_HEAD` are not touched. The command prints how to delete the two refs.
* Anywhere else, it makes a blobless partial clone (`--filter=blob:none --no-checkout`) in the temp directory, `testwitness-pr-clones-<uid>/<owner>/<repo>`, next to the helper index cache. The next run on the same repository reuses it and only fetches the new commits. The command prints where the clone is and the `rm -rf` line that deletes it.
* Base is the merge base of the pull request head and its base branch; head is the pull request head commit.
* It is a trial, so no test results are read: `--diff-only` applies on its own and the evidence section says so. The helper index is not used either. `.testwitness.yml` is read from the merge base only, unless you pass `--config`.
* One unauthenticated request to `api.github.com` reads the title, the body and the base branch. When it fails (offline, blocked, or the 60 requests an hour limit), the check goes on without the title and body, one line in the report says so and names the claim rules that were skipped (V004 and V006), and the base is the repository's default branch.
* Output is what `check` prints anywhere else: text at a terminal, markdown in a pipe, `--format` and `--out` as usual.

What it fetches and why that is safe: [security](./security#the-pr-trial).

**Checking an existing pull request.** Fetch its head and check it out, because the helper index reads helper files from the working tree, not from `--head`:

```bash
git fetch origin pull/123/head:pr-123
git checkout --detach pr-123
testwitness check --base origin/main --head pr-123 --diff-only
```

Use the branch the pull request targets as `--base` (a backport or release branch is not `main`), or the CLI compares far more than the pull request changed. Once the pull request is merged with a merge commit, its head is already inside that branch and there is nothing to compare; use the first parent of the merge commit instead (`--base <merge commit>^1`). The CLI says "Nothing to compare" with the state `unreadable` when that happens, never `pass`.

**What `unreadable` means without results.** Without test results the diff rules still run, but nothing confirms which tests ran, so the state reads `unreadable` and V005 asks for a reporter. That is expected on a laptop. Pass `--diff-only` to say you only want the diff and claim rules: no results are searched for, V005 is skipped and the state is `pass` or `review`.

`testwitness hook --agent claude|cursor|codex|git [--base <ref>] [--timeout <seconds>] [--results <globs>] [--cwd <dir>]` is the [agent guard](./agent-guard). It reads the agent's hook event JSON on stdin (for `git`, the pre-push lines), checks the working tree when the event is a `git commit`, a `git push` or the end of a turn, and answers in that agent's blocking format. It blocks on open findings at or above `fail_on` (medium by default; A002 only at high) of the rules on its blocking list (the proven rules R003, R004, R005 and A002 plus W006 by default, `hook.blocking` in the base config), at most twice per finding and session, and allows the action with a note when it crashes or runs past the timeout (20 seconds, or `hook.timeout` in the base config). Configuration is read from the merge base only. Exit code 0, except `--agent git`, which exits 1 to refuse a push.

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
