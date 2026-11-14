# MCP server for coding agents

`testwitness mcp` starts a Model Context Protocol server on stdio. A coding agent such as Claude Code, Cursor or Codex can then run the same check the GitHub Action runs, on its own branch. Every finding comes with a file, a line, a rule and the code before and after, so the agent can look up what a finding means and fix its own weakened tests.

The server is a tool the agent may call. It does not make the agent call it. To have the check run whether or not the agent thinks of it, install the [agent guard](./agent-guard) (`testwitness init --agent claude`, `cursor`, `codex` or `git`): a hook that runs on commit, push and stop and blocks on its own. The two work together: the hook blocks and names the rule, and the agent can call `testwitness_explain_rule` to understand it.

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
| `testwitness_check` | `cwd` (required), `base`, `head`, `results`, `junit`, `prTitle`, `prBody`, `mode` | The report and a short text summary |
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
| `prTitle`, `prBody` | Pull request text, for claim checks such as "all tests pass" | none |
| `mode` | `report`, `require-ack` or `strict` | from `.testwitness.yml` |

The MCP check compares commits, so uncommitted changes are not seen; `testwitness check --worktree` and the [agent guard](./agent-guard) compare the working tree. Configuration is read from the base ref, the same as in CI, so a branch cannot relax its own check.

R001 is not a proven rule, so its finding is capped at low; the JSON report keeps the rule's own severity in `uncappedSeverity`. The structured result is the full JSON report, `schemaVersion` 1, described by the JSON Schema at `https://testwitness.github.io/testwitness/report.schema.json` (source: `docs/report.schema.json` in the repository). The text content is a summary for the agent to read first:

```text
testwitness review: 1 high, 0 medium, 2 low open findings (0 acknowledged). Evidence: unreadable.
high A002 src/math.test.ts:6: Test add › adds two numbers: expect.toBe on add(1, 2) became expect.toBeDefined
low R001 src/math.test.ts:9: Test add › handles negatives was deleted
low V005 results: No test results found for this run. Add a reporter (...) so changed tests can be checked against what ran. (unreadable)
```

It lists the state, the open counts by severity and the first five open findings with severity, rule, file, line and reason, then any notes from the run (for example that no test results matched). A ref that starts with a dash, a path that is not a git repository or an unknown ref comes back as a tool error with a plain message.

### testwitness_explain_rule

Takes a rule id from a finding, such as `A002`, and returns the entry from the [rules reference](/rules): what the rule flags, how it avoids false positives and an example diff. Use it when a finding is not obvious.

### testwitness_rules

Lists every built in rule with its id, name and default severity.

## Do not rely on an instruction

An earlier version of this page suggested pasting a "run testwitness_check before pushing" rule into `CLAUDE.md`, `AGENTS.md` or `.cursor/rules`. The evidence says that is not enough. In 89 public reports of agents weakening tests that we read in November 2026, 8 say a written rule was in the agent's context and the agent ignored it ([one](https://github.com/anthropics/claude-code/issues/45550) had "Never skip failing tests" in a project skill; [another](https://github.com/anthropics/claude-code/issues/60177) had "test before claiming done" in `CLAUDE.md`). An instruction is a request. A hook is not.

So the way to get the check run is the [agent guard](./agent-guard), which does not depend on what the agent was told. The MCP tool also compares commits, not the working tree, so it sees a change only after the agent has committed it; the hook checks the working tree before the commit exists.

If you still want a note in your instruction file, keep it to what helps the agent after a block:

```markdown
## Test integrity

testwitness checks this repository on commit, push and at the end of a turn.

* If it blocks, restore the base text it shows, or keep the change and say why in the pull request description.
* Do not skip, delete or loosen a test to make a change pass. If a test is wrong, say so and leave it for a human.
* Use testwitness_explain_rule when a finding is unclear.
```

Editing `.testwitness.yml` or the hook config on the branch acknowledges nothing: both are read from the base ref, and rule W006 flags the edit for a maintainer. The agent's part is to fix the finding or explain it; a maintainer acknowledges it.
