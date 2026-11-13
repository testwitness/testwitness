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
| `--base <ref>` | base ref; the merge base with head is used | `origin/main` |
| `--head <ref>` | head ref | `HEAD` |
| `--results <globs>` | comma separated globs of test results: JUnit XML (recommended), TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright, told apart by content ([evidence](./evidence)) | from config `results.head` |
| `--junit <globs>` | older name of `--results`, used when `--results` is not given | |
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

`testwitness mutate-plan --base <ref> --head <ref> [--format json|shell] [--out <file>] [--cwd <dir>]` prints the production files the PR changed and the settings that mutate only them: StrykerJS `--mutate` line ranges with `--incremental`, and PIT `targetClasses` and `targetTests`. It reads git and runs nothing. The shell format is single quoted variable assignments for a workflow to source. See [mutation on request](./mutation-on-request).

`testwitness mcp` starts a read only MCP server on stdio so coding agents can run the check before pushing; see [MCP server for agents](./mcp).

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
