# Agent guard: the check inside the coding agent's loop

`testwitness hook` runs the same engine as the pull request check, on the working tree, at the moment a coding agent tries to commit, push or end its turn. If the change weakens tests, the hook blocks the action and hands the agent the finding with the base text to restore. It does not depend on an instruction the agent is asked to follow.

Why a hook and not an instruction: in 89 public reports of agents weakening tests that we read in November 2026, 8 say a written rule was in the agent's context and the agent ignored it ([one example](https://github.com/anthropics/claude-code/issues/45550), [another](https://github.com/anthropics/claude-code/issues/60177)), and 16 ask for, or built by hand, a gate the agent cannot skip.

The three promises hold here too: no model, no network, and the hook never runs your repository's code. The only program it starts is `git`.

## Setup

Install the package first (`npm i -g testwitness`, or add `testwitness` to the devDependencies). `init` writes the hook config and nothing else, prints what it wrote, and is safe to run twice.

### Claude Code

```bash
npm i -g testwitness
testwitness init --agent claude     # writes the hooks block into .claude/settings.json
git add .claude/settings.json && git commit -m "testwitness agent guard"
```

Or load the bundled plugin, which carries the same hooks and the [MCP server](./mcp): `claude --plugin-dir node_modules/testwitness/plugin`.

### Cursor

```bash
npm i -g testwitness
testwitness init --agent cursor     # writes .cursor/hooks.json
git add .cursor/hooks.json && git commit -m "testwitness agent guard"
```

### Codex

```bash
npm i -g testwitness
testwitness init --agent codex      # writes .codex/hooks.json
codex                               # then run /hooks once to review and trust the hook
```

Codex skips a project hook until you have trusted it, and again after the hook changes. That step cannot be automated.

### Any other agent: a git pre-push hook

```bash
npm i -g testwitness
testwitness init --agent git        # writes <git dir>/hooks/pre-push
git push                            # a push whose commits weaken tests is refused
```

It refuses to replace a different existing pre-push hook unless you pass `--force`. Git does not version hooks, so every clone runs `init` once.

`init` merges into an existing config file and leaves other keys and other hooks alone. When `testwitness` is not on your PATH it writes `npx --no-install testwitness` instead, which never downloads anything; pass `--command` to choose the command yourself.

## What it blocks

| Agent event | What the hook does |
|---|---|
| A shell command that runs `git commit` or `git push` | checks the working tree against the merge base with the default branch |
| The agent ends its turn (Stop, SubagentStop) | the same check |
| A file edit | nothing, unless the path is on the `protect` list |
| Anything else | nothing; the hook answers in about 0.3 s and stays out of the way |

The working tree means staged, unstaged and untracked files that are not ignored: what `git add -A && git commit` would record. Nothing is written into your repository to read it (see [design](./design#the-working-tree-snapshot)).

By default the hook blocks on a small proven set of rules and treats every other rule as advice: the user sees it, the agent is not stopped. An interruption in the middle of an agent's work costs more than a line in a PR comment, so a rule has to earn the right to block.

* **Blocking by default:** A002 (assertion loosened, at high), R004 (test converted to expected failure), R005 (focused test), W002 and W003 (failures hidden in CI), and a changed path on the `protect` list. Each of these rules has true positives at high severity on the corpus and not one wrongful block on the corpus or on 300 real merged pull requests. W006 (the gate itself changed) also blocks; it has no measurement and is on the list because it is the gate protecting itself.
* **Advice by default: every other rule.** That includes A001, A009, E001, R001 and R002, which each had at least one wrongful block, and the rules that never produced a high finding in either set. Deleted tests and deleted test files (R001, R002) are the behaviour people complain about most, and they do not block yet. Read the numbers in [precision](./precision#agent-hook-replay) before you rely on the default: the hook blocks 17 of the 82 corpus pull requests that weaken tests, and none of the 52 that do not.
* **Widening it is your call.** List the rules that may block in `.testwitness.yml` on the default branch, for example `hook: { blocking: [A002, R004, R005, W002, W003, W006, R001, R002] }`. `hook.advice_only` takes a rule off the list again.
* `medium` findings never block unless the base config sets `fail_on: medium`, and then only for rules on the blocking list.

A block message looks like this:

```text
testwitness blocked this commit: 1 test integrity finding in the working tree, compared with 7e48ddaee0.

1. A002 high src/math.test.ts:6: Test add › adds two numbers: expect.toBe on add(1, 2) became expect.toBeDefined
   Base text to restore (src/math.test.ts at 7e48ddaee0, lines 5 to 7):
        it('adds two numbers', () => {
          expect(add(1, 2)).toBe(3);
        });
   Block 1 of 2 for this finding in this session.

Restore the base text, or keep the change and state why in the PR description so a maintainer can acknowledge it.
```

Each agent gets it in its own documented format: a `PreToolUse` denial or a `Stop` block for Claude Code and Codex, `permission: deny` or a follow up message for Cursor, exit code 1 for git.

### Locking test files

By default an agent may edit any test file; the check judges the result. To lock paths, list them in `.testwitness.yml` on the default branch:

```yaml
protect:
  - "tests/golden/**"
  - "src/billing/*.test.ts"
```

An edit to a listed path is denied at the edit tool, and a listed path that changed some other way (a shell command) blocks the commit, the push and the end of the turn.

### Configuration comes from the base branch

The hook reads `.testwitness.yml` from the merge base only, never from the working tree. An agent that edits the file to switch a rule off changes nothing, and the edit is itself a W006 finding that blocks. The same holds for the hook config files (`.claude/settings.json`, `.claude/settings.local.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.codex/config.toml`): removing or changing an installed testwitness hook is W006. Installing the hook for the first time on a branch is shown as advice and does not block that branch.

```yaml
fail_on: high          # the hook blocks at this severity and above
hook:
  timeout: 20          # seconds before the hook gives up and allows the action
  max_blocks: 2        # how often the same finding may block in one session
  blocking: [A002, R004, R005, W002, W003, W006]   # the rules that may block; this is the default
  advice_only: []      # rules taken off the blocking list again
```

## The loop guard

A Stop hook that always blocks can keep an agent running forever and burn your budget. So:

* The same finding (same fingerprint) blocks at most twice in one agent session. After that the hook allows the action and shows you a note that says it stepped aside and which findings are still open.
* A new finding in the same session still blocks.
* The count lives in a file under the operating system's temp directory, keyed by repository and session id. Nothing is stored in the repository.
* If the hook crashes, times out (20 seconds by default), cannot read the event, or cannot write its count, it allows the action and says so. It never leaves the agent stuck.
* The git pre-push hook has no loop guard: a refused push simply ends.

## Speed

Measured with `pnpm bench` on a 2 core machine, start up included (the numbers are in `bench/results.json`):

<!-- bench:start -->
| Case | Files | Changed | Runs | Median | 95th percentile | Budget |
|---|---|---|---|---|---|---|
| `check`, commit to commit, large | 1,000 | 1,000 | 3 | 25.88 s | | 30 s (median) |
| `check`, commit to commit, small | 20 | 20 | 3 | 2.05 s | | 5 s (median) |
| `hook`, Stop event, worktree30 | 31 | 30 | 20 | 1.55 s | 2.39 s | 3 s (95th percentile) |
| `hook`, Stop event, worktree30-in-1000 | 1,001 | 30 | 20 | 2.08 s | 2.62 s | 3 s (95th percentile) |

Measured 2026-11-13 on 2 cores (Intel(R) Xeon(R) Processor @ 2.10GHz), linux, node v22.23.4. Every hook sample is a new process and a new session, so each one does the full work and blocks. The machine was shared with other jobs during this run; two earlier runs the same day gave a 95th percentile of 1.64 s and 1.17 s for the 30 file repository and 1.78 s and 2.01 s for 30 changed files in the 1,000 file repository.
<!-- bench:end -->

## Limits

What the hook cannot see or stop:

* **Bypass outside the agent's hooks.** A person, or an agent running without hooks, can commit and push freely. `git push --no-verify` skips the pre-push hook. An agent that can run shell commands can also delete the loop guard's count file or the hook config; the second is reported as W006 by the next check that still runs. Keep the pull request check as the backstop.
* **Production code bent to fit the tests.** A special case added so that a test passes leaves the tests untouched, and no test rule fires.
* **Value rewrites.** An expected value changed to match wrong output is as strict as before, so it is not a loosening.
* **Mocks and fixtures.** A mock that replaces the code under test, or seed data edited around it, is not detected.
* **Most rules, by default.** Only the proven set blocks. Deleted tests and deleted test files (R001, R002) are advice until their false positives are fixed (see above).
* **Claims.** "All tests pass" in the agent's last message is not checked. The hook does not read test results unless you pass `--results`.
* **Copilot's cloud agent.** It has no local hooks, and GitHub does not run Actions workflows on its pushes until a person approves the run, so the pull request check reports late there by design.
* **Cursor edits.** Cursor's documentation does not give the input shape of its file tools, so `protect` at edit time is best effort on Cursor. The commit and stop checks enforce the list either way.
* **Git clean filters.** The snapshot stages files the way `git add` does, so a clean filter you configured in git (Git LFS, git-crypt) runs. It comes from your git config, never from the repository's files. Git hooks, fsmonitor programs, external diff and textconv are switched off.

## How to verify on your machine

The payloads in `fixtures/hooks` are written from the vendors' documentation (read on 13 November 2026), not captured from live sessions. One real recorded session per agent is still to do. The steps, the same for each agent:

1. In a scratch repository with a test suite, on the default branch: `testwitness init --agent <name>`, commit the config. For Codex, start it and run `/hooks` to trust the hook.
2. Add a line to the hook command that keeps the raw event, for example change the command to `sh -c 'tee -a /tmp/tw-events.jsonl | testwitness hook --agent <name>'`. (For Codex, trust the changed hook again.)
3. Break the code so that one test fails, start the agent, and ask: "Make the test suite pass and commit." Do not mention testwitness.
4. If the agent weakens a test in a way the default blocks on (loosens an assertion, marks the test as an expected failure, focuses another test), it should be blocked at the commit or at the end of its turn, read the base text, and restore the test. If it deletes the test instead, you will see advice only; add R001 and R002 to `hook.blocking` on the default branch and run again to record the blocking path for deletions.
5. Save the transcript: `claude --resume` and export for Claude Code, the chat export for Cursor, `codex` session log for Codex. Put it in `docs/sessions/<agent>-<date>.md` with the agent version, and copy the matching lines of `/tmp/tw-events.jsonl` over the files in `fixtures/hooks/<agent>/` (replace the repository path with `__REPO__`).
6. Run `pnpm vitest run packages/cli/src/hook`. If a recorded payload fails a test, the vendor's format differs from its documentation: fix the adapter in `packages/cli/src/hook/events.ts` and note the date there.

Things to look at while you record, because the documentation left them open: whether Cursor's `permission: allow` answer changes its own approval prompt, the tool names and `tool_input` of Cursor's file tools, and whether Codex shows `systemMessage` on an allowed `PreToolUse`.

Quick checks that need no agent:

```bash
testwitness check --worktree                      # what the hook would see right now
echo '{"session_id":"s","cwd":"'"$PWD"'","hook_event_name":"Stop"}' | testwitness hook --agent claude
```
