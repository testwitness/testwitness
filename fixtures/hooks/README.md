# Hook payload fixtures

One file per hook event the agent guard (`testwitness hook --agent <name>`) handles, per agent. The tests in
`packages/cli/src/hook/hook.test.ts` feed each file to the hook on stdin and assert the answer in that agent's blocking
format. `__REPO__` is replaced with the path of a temporary repository and `__LOCAL_SHA__` with its head commit.

## Where the payloads come from

They are written from the input examples and field tables in each vendor's hook documentation, as read on the date
below. They are not captures of live sessions: no agent could be run where these were made. `docs/agent-guard.md`
("How to verify on your machine") has the steps to record a real one per agent; replace the matching file here when
you do, and note the agent version.

| Agent | Documentation | Read on | Events covered |
|---|---|---|---|
| Claude Code | https://code.claude.com/docs/en/hooks | 13 Nov 2026 | PreToolUse (Bash, Edit, Write), Stop, SubagentStop |
| Cursor | https://cursor.com/docs/agent/hooks | 13 Nov 2026 | beforeShellExecution, preToolUse (Write), stop, subagentStop |
| Codex | https://learn.chatgpt.com/docs/hooks | 13 Nov 2026 | PreToolUse (Bash, apply_patch), Stop |
| git | https://git-scm.com/docs/githooks#_pre_push | 13 Nov 2026 | pre-push (stdin lines) |

None of the three vendor pages shows a "last updated" date, so the read date is the reference.

## What the documentation did not settle

* Cursor: the page gives no `tool_input` shape for the file tools in `preToolUse`. The fixture uses `file_path`, the
  name `afterFileEdit` documents; the adapter also accepts `path` and `target_file`.
* Cursor: the page names the tools "Shell, Read, Write, MCP, Task, etc." and no others, so the edit tool names beyond
  `Write` are a guess.
* Codex: `tool_input.command` is documented for Bash and apply_patch; the apply_patch body in the fixture follows the
  patch format Codex prints, which the hook page does not spell out.
