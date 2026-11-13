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
    junit: "**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml"
```

| Option | Meaning | Default |
|---|---|---|
| `--base <ref>` | base ref; the merge base with head is used | `origin/main` |
| `--head <ref>` | head ref | `HEAD` |
| `--junit <globs>` | comma separated globs of JUnit XML | from config |
| `--config <path>` | `.testwitness.yml` path | base ref, then working tree |
| `--format <fmt>` | `markdown`, `json` or `both` | `markdown` |
| `--out <path>` | write to a file instead of stdout | |
| `--mode <mode>` | `report`, `require-ack`, `strict` | from config |
| `--fail-on <sev>` | `high`, `medium`, `low` | from config |
| `--pr-title <t>`, `--pr-body-file <f>` | PR text for claim checks | |
| `--author <login>`, `--author-type <type>` | PR author and account type, shown in provenance | |
| `--cwd <dir>` | repository directory | current |
| `-q, --quiet` | no progress on stderr | |

`testwitness rules` lists the built in rules.

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
    - npx testwitness check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --head HEAD --junit "**/junit*.xml" --format markdown --out testwitness.md
  artifacts:
    paths: [testwitness.md]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```
