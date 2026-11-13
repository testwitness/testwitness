# MCP server for coding agents

`testwitness mcp` starts a Model Context Protocol server on stdio. A coding agent such as Claude Code, Cursor or Codex can then run the same check the GitHub Action runs, on its own branch, before it pushes. Every finding comes with a file, a line, a rule and the code before and after, so the agent can fix its own weakened tests and the reviewer sees a pull request that already passed.

The server is read only. It reads the git history and files as text, never executes repository code (no install, no test run, no import of config files) and makes no network calls. It is part of the `testwitness` npm package; there is nothing extra to install.

## Add it to your agent

### Claude Code

```bash
claude mcp add testwitness -- npx -y testwitness mcp
```

Add `--scope project` before the `--` to share it with everyone on the repository through `.mcp.json`, or `--scope user` to have it in every project. The `.mcp.json` entry looks like this:

```json
{
  "mcpServers": {
    "testwitness": {
      "command": "npx",
      "args": ["-y", "testwitness", "mcp"]
    }
  }
}
```

### Cursor

Put this in `.cursor/mcp.json` in the repository, or in `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "testwitness": {
      "command": "npx",
      "args": ["-y", "testwitness", "mcp"]
    }
  }
}
```

### Codex

Add a table to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.testwitness]
command = "npx"
args = ["-y", "testwitness", "mcp"]
```

These shapes were checked against the Claude Code, Cursor and Codex documentation in November 2026. If your agent rejects them, check its current MCP documentation, since config formats change between releases.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `testwitness_check` | `cwd` (required), `base`, `head`, `results`, `junit`, `coverage`, `mutation`, `prTitle`, `prBody`, `mode` | The report and a short text summary |
| `testwitness_explain_rule` | `ruleId` | The rule's summary, false positive controls and an example |
| `testwitness_rules` | none | Every rule id with its name and default severity |

### testwitness_check

Inputs:

| Input | Meaning | Default |
|---|---|---|
| `cwd` | Absolute path of the repository | required |
| `base` | Base ref; the merge base with head is compared | origin's default branch, else `origin/main`, `origin/master`, `main` or `master` |
| `head` | Head ref | `HEAD` |
| `results` | Comma separated globs of test results, relative to the repository root: JUnit XML, TAP, or Jest, Vitest, pytest-json-report or Playwright JSON, told apart by content ([evidence](./evidence)) | from `.testwitness.yml` |
| `junit` | Older name of `results`, used when `results` is not given | |
| `coverage` | Comma separated globs of lcov, Cobertura or JaCoCo coverage reports, relative to the repository root | from `.testwitness.yml` `coverage.paths` |
| `mutation` | Comma separated globs of Stryker JSON or PIT mutations.xml reports, relative to the repository root; read only, the server never runs a mutation tool ([mutation on request](./mutation-on-request)) | from `.testwitness.yml` `mutation.paths` |
| `prTitle`, `prBody` | Pull request text, for claim checks such as "all tests pass" | none |
| `mode` | `report`, `require-ack` or `strict` | from `.testwitness.yml` |

The check compares commits, so commit before you call it: uncommitted changes are not seen. Configuration is read from the base ref, the same as in CI, so a branch cannot relax its own check.

The structured result is the full JSON report, `schemaVersion` 1, described by the JSON Schema at `https://testwitness.github.io/testwitness/report.schema.json` (source: `docs/report.schema.json` in the repository). The text content is a summary for the agent to read first:

```text
testwitness review: 1 high, 1 medium, 1 low open findings (0 acknowledged). Evidence: unreadable.
high A002 src/math.test.ts:6: Test add › adds two numbers: expect.toBe on add(1, 2) became expect.toBeDefined
medium R001 src/math.test.ts:9: Test add › handles negatives was deleted
low V005 results: No test results found for this run. Add a reporter (...) so changed tests can be checked against what ran. (unreadable)
```

It lists the state, the open counts by severity and the first five open findings with severity, rule, file, line and reason, then any notes from the run (for example that no test results matched). A ref that starts with a dash, a path that is not a git repository or an unknown ref comes back as a tool error with a plain message.

### testwitness_explain_rule

Takes a rule id from a finding, such as `A002`, and returns the entry from the [rules reference](/rules): what the rule flags, how it avoids false positives and an example diff. Use it when a finding is not obvious.

### testwitness_rules

Lists every built in rule with its id, name and default severity.

## Suggested agent instruction

Add this to `CLAUDE.md`, `AGENTS.md`, `.cursor/rules` or wherever your agent reads its project instructions:

```markdown
## Test integrity

Before pushing, run testwitness_check on this repository and fix every medium or high finding or acknowledge it with a reason.

* Commit first; the check compares commits, not the working tree.
* Fixing means restoring the deleted test, the removed assertion or the original matcher, or replacing it with a check that is at least as strict.
* Do not skip, delete or loosen a test to make a change pass. If a test is wrong, say so in the pull request description and leave it for a human.
* If a finding is intended (a test moved, a feature removed), say which finding it is and why in the pull request description. A maintainer acknowledges it in .testwitness.yml.
* Use testwitness_explain_rule when a finding is unclear.
```

Editing `.testwitness.yml` on the branch acknowledges nothing: configuration is read from the base ref, and rule W006 flags the edit for a maintainer. The agent's part is to fix the finding or explain it; a maintainer acknowledges it.
