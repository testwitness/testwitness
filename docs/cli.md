# CLI

```bash
npx testwitness check [options]
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
| `--cwd <dir>` | repository directory | current |

`testwitness rules` lists the built in rules.

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
