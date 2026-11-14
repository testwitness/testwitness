# Threat model

testwitness reads a pull request and writes about it. Everything it reads is chosen by the person who opened the pull request, and everything it writes is read by a reviewer, by GitHub, by a terminal or by a coding agent. This page lists what an attacker controls, what they could gain, what the code does about it, and what it does not do.

It was written during the security review of 13 November 2026 (branch `sec/review`). Every claim here was checked in the code on that day. Where a test proves a claim, the test is named. The review found 19 problems and fixed them, and left 1 open with a failing test that documents it. They are listed at the end.

Short version for people who only need the rules: [SECURITY.md](https://github.com/testwitness/testwitness/blob/main/SECURITY.md). How to set up the workflow: [Fork PRs and security](./security).

## Who the attacker is

1. **A contributor without write access**, usually from a fork. They control every file in the pull request, its title and body, the names of its tests and files, and the result files its test run writes. They want a weakened test to pass review, or they want to use the bot's output against the reviewers.
2. **A coding agent** working in a developer's checkout, guarded by `testwitness hook`. It controls the working tree and the shell commands it runs. It wants to commit or stop without restoring a test.
3. **A repository the user does not trust**, cloned to a developer machine where the hook or the MCP server runs. It controls every file and every branch in the clone.
4. **A client of the MCP server**, which is a model that may be acting on instructions it read in a file.

Out of scope: someone with write access to the repository (they can change the workflow, the config on the base branch and the branch protection), a compromised runner image or GitHub itself, and a maintainer who wires the Action into a workflow that hands secrets to pull request code.

## What is worth protecting

* **The verdict.** A pull request must not be able to switch off the rules that judge it, or hide a finding.
* **The reviewer's attention.** The comment, the annotations and the job summary must say what testwitness found and nothing an attacker wrote in its voice: no pings, no links, no forged rows, no forged annotations.
* **The runner and the developer machine.** No code from the pull request runs, no file outside the checkout is read without being asked for, no file is written through a link, nothing is sent anywhere.
* **The check's own availability.** A small file must not make the check run for hours or crash.

## Fork pull requests, tokens and permissions

What the Action expects:

```yaml
on: pull_request
permissions:
  contents: read
  pull-requests: write   # optional, for the comment
  actions: read          # optional, for the run history artifact
```

No secrets. On a pull request from a fork GitHub gives the job a read only token whatever the workflow asks for. The check still runs: findings become annotations, the job summary and `testwitness.json`. The comment cannot be posted, and the Action says so in the log and does not fail (`packages/action/src/main.ts`, the `upsertComment` call is inside a `try`).

The Action calls the GitHub API for four things only: the pull request of an `issue_comment` event, the comments, labels and label events used for acknowledgements, the comment itself, and the history artifact. The engine makes no network call at all.

**`pull_request_target`.** Do not use it for the check. If someone does:

* The job gets a write token and whatever secrets the workflow names, and the default checkout is the base branch. testwitness then diffs the base against a head commit that is usually not in the checkout, and fails with a git error. Nothing is leaked by that.
* If the workflow also checks out the pull request's head (the usual way people make it "work"), testwitness itself still does not execute anything from it. The danger is every other step: an install or a test run in the same job runs the pull request's code with the write token and the secrets. That is a property of the workflow, not of testwitness, and nothing in testwitness can prevent it. It is the first item under "Out of scope" in SECURITY.md.
* The supported way to comment on fork pull requests is a second workflow on `workflow_run` that downloads `testwitness.json` and renders it. That workflow must treat the JSON as untrusted, because the fork's run wrote it. `renderMarkdown` escapes every field of a report it is handed, including the ones that are not text when testwitness wrote them (test: `render.fuzz.test.ts`, "a report read from a JSON file cannot inject through fields that are not text"). Validate the file against `docs/report.schema.json` as well.

**What a `pull_request` workflow cannot promise.** On `pull_request` events GitHub runs the workflow file from the pull request's own merge commit. A pull request can therefore edit or delete the testwitness step. testwitness reports an edit as W006 when it runs, but a workflow that no longer runs it reports nothing. Only repository settings close this: make the check required, and if the gate matters, run it from a ruleset workflow or a `workflow_run` workflow that the pull request cannot edit. This is a limit of the event, listed under known limits.

## Config

Rule: **a config that is part of the change being judged is never read.**

| Entry point | Where `.testwitness.yml` comes from | Code | Test |
|---|---|---|---|
| Action | The merge base only (`configFromBaseOnly: true`). A `config` input that names a file inside the repository is also read at the merge base, because on a pull request the checkout holds the pull request's copy. A path outside the repository is read from disk. | `packages/action/src/main.ts`, `loadConfig` in `packages/cli/src/check.ts` | `config-source.test.ts` |
| CLI | The merge base. Without a config there, a working tree file is read only when it is local and uncommitted, so it is not in the commits being compared. A config that the head commit adds, or any working tree config in `--worktree` mode, is ignored with a log line. An explicit `--config` is the operator's choice and is read from disk. | `loadConfig` | `config-source.test.ts` |
| Hook | The merge base only, always. | `packages/cli/src/hook/run.ts` | `hook.test.ts`, "the working tree cannot relax the check" |
| MCP server | The merge base only. | `packages/cli/src/mcp.ts` | `mcp.test.ts` |

This was the most serious finding of the review (F1). Before the fix, the Action and the CLI fell back to the working tree when the base branch had no `.testwitness.yml`, which is the state of most repositories. A pull request could add a config with every rule off, W006 included, and the check passed. The earlier review had verified the base read but not the fallback.

A change to `.testwitness.yml`, to the workflow step or to an agent hook config is reported as W006. W006 cannot be acknowledged by the label or by the author, only by a comment command from someone with write access.

**Who may acknowledge.** A comment command counts when its author is not the pull request author and has write or admin permission on the repository. The permission is looked up through the API. The comment's `author_association` alone is not enough: `MEMBER` is any member of the organisation and `COLLABORATOR` includes read only collaborators (F8; test: `acknowledge.test.ts`, "withWriteAccessOnly"). The label counts when the person who applied it has write access and is not the author.

## Untrusted text in every output

Text an attacker controls: test names, describe titles, file paths (git allows line breaks and any byte but NUL in a path), assertion source text, the PR title and body, commit messages, and everything in result, coverage and mutation files.

One function decides which characters never reach any output (`packages/core/src/report/sanitize.ts`): C0 and C1 controls including ESC, DEL, the bidirectional controls, zero width and invisible format characters, Unicode tag characters and unpaired surrogates become U+FFFD. Line breaks of every kind (LF, CR, CR LF, VT, FF, NEL, U+2028, U+2029) and tabs become a space in single line outputs.

| Output | Risk | Defence | Test |
|---|---|---|---|
| Markdown comment and job summary | Mentions, links, issue references, HTML, forged table rows, a forged heading, hidden text | `esc`: safe single line, cut to 600 characters, `&` to `&amp;` so the text cannot carry its own character references, backslash before every Markdown special character, a zero width space after `@`, after `#` and `GH-` before a digit, after every `:` before `//` and inside every `www.`. `escBlock` also guards the start of a line. Paths are shown in a code span (`codeCell`), where GitHub links nothing and notifies nobody. | `render.fuzz.test.ts` |
| Workflow annotations | A `::error::` or `::stop-commands::` line, a line break | Text is reduced to one safe line and cut to 1,000 characters, then written through `@actions/core`, which percent encodes `%`, CR and LF in the message and also `:` and `,` in the properties. | `annotations.fuzz.test.ts` |
| Step log | The same, through a file name or a results file quoted in a log line. In the older `##[name]` form a command does not even need to start the line. | Every log line built from untrusted text goes through `info()`: one safe line behind the fixed prefix `testwitness: `, with `##[` broken up. | `annotations.fuzz.test.ts` |
| SARIF | | testwitness does not write SARIF. Checked: no occurrence of the word in `packages/`, `action.yml` or the docs. | |
| JSON | Control characters when the file is printed or opened | `JSON.stringify` escapes C0. DEL, C1, U+2028, U+2029 and the bidirectional controls are written as `\u` escapes too, so the document parses to the same value. The JSON is data: a consumer that renders it must escape it. | `render.fuzz.test.ts` |
| Terminal text | ANSI escapes, cursor moves, bidirectional reordering | `plain`: safe single line, messages cut to 1,000 characters. The only escape sequences in the output are the renderer's own colour codes. | `render.fuzz.test.ts` |
| Hook answer | Escape sequences on a terminal (git pre-push writes the reason to stderr), invisible instructions to a model | The reason and the note keep LF and tab and lose every other unsafe character. For the JSON shapes the text is then serialised by `JSON.stringify`. | `events.fuzz.test.ts` |
| MCP text summary | The same | One safe line per finding, cut to 1,000 characters. | `mcp.test.ts` |

Two things the escaping does not do. A tilde is escaped only where it could open a strikethrough, and `:name:` emoji codes are left alone, so text from a pull request can strike itself through or show an emoji. And the comment is cut at 60,000 characters, so a pull request with very many findings pushes the low ones out of the comment (the JSON has all of them, and the comment says it was cut).

**Text meant for a model.** The hook's block reason and the MCP summary quote test names and the base text of a test. That text can contain instructions. testwitness removes what a person could not see (control, bidirectional, invisible and tag characters) but it cannot remove visible sentences. The quoted text is marked as such in the reason, and what the agent is asked to do is fixed text. An agent that follows instructions found in a test name is a problem the hook does not solve.

**The comment the Action updates.** It looks for a comment that starts with its marker and was written by a bot account or by someone with write access. It used to take the first comment that contained the marker, whoever wrote it, so anyone could plant a comment and have the report written into it, and then edit it (F9; test: `annotations.fuzz.test.ts`, "which comment the Action updates").

## Result globs: path traversal and symlinks

Verified, unchanged from the earlier review (tests: `symlinks.test.ts`, `paths.test.ts`):

* The globs come from the workflow inputs, the command line or the base config. None comes from the pull request.
* A matched file that is a symbolic link, or whose real path is outside the repository through a linked directory, is skipped with a note. `paths.followSymlinks` turns that off for Bazel and is read from the base config only.
* A glob with an absolute or `..` base reads outside the repository on purpose. That is the workflow author's choice.

New in this review:

* **Writing.** `testwitness.json`, `testwitness.md`, the history file and the CLI's `--out` and `--history-out` are no longer written through a symbolic link at the destination. A pull request could commit `testwitness.json` as a link to any file the runner user can write (F5). The Action also no longer writes the PR body to `.testwitness-pr-body.txt` in the checkout; it is passed in memory. Tests: `safe-write.test.ts`, `hostile-repo.test.ts`.
* **MCP.** Globs passed by an MCP client must be relative and may not contain `..` (F17; test: `mcp.test.ts`).

## Oversized or malicious XML and JSON

| Input | What was tried | Result | Test |
|---|---|---|---|
| XML (JUnit, Cobertura, JaCoCo, PIT) | Entity expansion (billion laughs) | saxes knows the five XML entities only. Others are left as written and reported as an error. Nothing is expanded. | `readers.fuzz.test.ts`, `evidence-readers.fuzz.test.ts` |
| | External entities, DOCTYPE with SYSTEM | Never resolved. No file or URL is opened. | same |
| | 100,000 levels of nesting | Read. The readers keep a counter or a stack, no recursion. | `readers.fuzz.test.ts` |
| | A 5 MB attribute, `time="1e999"`, a 400 digit number | Read. A time that is not finite or is negative is dropped (F15). | same |
| | One XML error every three bytes | Was one warning per error: 900 kB gave 300,000 warnings, and a file at the 500 MB cap would have exhausted memory. Now five notes per file and a count (F11). | same |
| JSON (Jest, Vitest, pytest, Playwright, Stryker, history) | 200,000 levels of nesting | `JSON.parse` throws, which becomes a note. Playwright suites are walked to 100 levels. | same |
| | Keys named `__proto__`, `constructor`; wrong types everywhere | Read as data. Lookup tables are read with own keys only (F15). `Object.prototype` is checked after every fuzz case. | `evidence-readers.fuzz.test.ts` |
| | Size | Results: 1,000 files and 500 MB, JSON 50 MB each. Coverage and mutation: 200 files and 50 MB. History: 10 MB. Over the cap is a note, not a read. | `reader.test.ts`, `review-hardening.test.ts` |
| TAP | A 1 MB line, a line of spaces with U+2028 in it | Lines over 1 MB are skipped. The four line patterns were cubic or quadratic on the second input and are linear now (F7). | `readers.fuzz.test.ts` |
| Runner config in the pull request (YAML, JSON, XML, TOML, JS) | 200,000 open brackets in `.mocharc.yml` | **Aborted the process** (exit 134) inside the YAML parser, which no `try` can catch. Now nesting is counted before parsing, and a changed config nested deeper than 200 levels is reported at high without being read, like one over 1 MB (F6). | `hostile-input.test.ts`, `hostile-repo.test.ts` |
| `.testwitness.yml` | YAML alias bomb, tags, syntax errors, deep nesting | The parser's own alias limit refuses the bomb. Every failure is a `ConfigError` now; it used to be the parser's own error type, which the CLI did not expect (F12). | `evidence-readers.fuzz.test.ts` |

## ReDoS

`scripts/security/redos-scan.mjs` lists every regular expression literal in the shipped source with the TypeScript parser (556 in 68 files on the review day), and runs each against inputs of 100,000 characters under a time limit of 2 seconds: repeated runs of 57 generic units and of the literal words of the regex itself, with and without a prefix, with five different endings. The 10 expressions built at run time were read by hand.

It found patterns that were quadratic or worse on text a pull request controls. All are replaced (F7). For each replacement a test checks two things: that it reads the same language as the old expression on 3,000 to 20,000 generated strings, and that the 100 kB input now takes well under 2 seconds (`hostile-input.test.ts` in core, lang-python and lang-ts, and the regression sections of the fuzz files).

| Where | Input that was slow | Before, 100 kB |
|---|---|---|
| Hook: `git commit` and `git push` detection | `git --a --a --a ... x` | exponential: 24 options 0.5 s, 40 would not finish (F2) |
| TAP: test point, plan, subtest and bail out lines | spaces, then a character, U+2028, a character | over 2 s each |
| PR text: checklist items, HTML comments, code fences, "fixes ... tests" | blank lines, `<!--` repeated, `fix fix fix` | 0.8 s to over 2 s |
| Test file sniffing (JavaScript and Python) | `describe` and spaces, a file of blank lines | over 2 s |
| Java package and method declarations, block comments | blank lines, `public public public`, `/* /* /*` | over 2 s |
| Gradle test selection and coverage thresholds | `exclude` and spaces, `minimum =` and spaces | over 2 s |
| Workflow and script lines: the command key, `--exitcode 0`, `uses: ...testwitness` | spaces, `uses:uses:uses:` | 1.5 s to over 2 s |
| Glob cleanup in runner configs | `)))))) x`, `////// !` | over 2 s |
| Template literal titles | `${${${` | over 2 s |
| The near duplicate tokenizer | `"\"\"\"\` on one line, unterminated `"""` | over 2 s |
| Python `except ... as name` | a long run of spaces inside the clause | over 2 s |
| PIT class names, diff headers | `$$$$` and a line break, ` b/ b/ b/` and U+2028 | over 2 s |

Three patterns stay as they are because their input is bounded where they are used: the format sniffers read the first 4,096 bytes of a file, the number pattern of the JS literal reader gets 40 characters, and the git error pattern gets the first 8,192 bytes of git's stderr.

The scan is a search, not a proof. A regular expression it did not flag can still be slow on an input it did not try.

## History and mutation artifacts: who can forge them

**History.** Verified, unchanged from the earlier review (`packages/action/src/history.ts`, test: `history.test.ts`). The artifact is read only from successful runs of the same workflow that were started by `push`, `schedule` or `workflow_dispatch` in this repository. A pull request run, from a fork or not, cannot supply it, even from a branch named like the base branch. It is uploaded only on a push to the default branch or with `history_write: true`. The file is validated and capped at 10 MB. It holds test keys and one character per run, nothing else.

Who can forge it: anyone who can push to the default branch or start those workflows, which means write access. A maintainer who sets `history_write: true` on pull requests opens it to every pull request; do not.

**Test results, coverage and mutation reports.** These are written by the pull request's own test run. A pull request can make that run write any report it likes: tests that never ran can be listed as passed, a survived mutant as killed. testwitness cannot tell a forged report from a real one, and no code change can fix that. What limits the damage: the diff rules (R, A, W, C, S, E) do not use evidence at all, so a forged report cannot remove their findings. Evidence only adds findings (V rules, M rules) or grades O001 and O002. If your threat is a contributor who forges reports, produce them in a job the pull request cannot edit.

The mutation workflow is the one place where pull request code runs on request. Its gate is in [mutation on request](./mutation-on-request): a comment by someone with write access, on a fork for a named head commit.

## The hook

`testwitness hook` runs on a developer machine. The event arrives on stdin from the agent's harness; the command line, the paths and the patch inside it are written by the model.

**What it never does** (verified by reading every import and by the existing tests):

* **No repository code.** The only child process is `git`, with the subcommands `rev-parse`, `merge-base`, `symbolic-ref`, `diff`, `show`, `cat-file`, `ls-tree`, `log`, `add`, `read-tree` and `write-tree`. `hook-safety.test.ts` traces every process started on a repository full of traps (package scripts, runner configs, git hooks, an fsmonitor program, an external diff, a textconv) and asserts none ran. There is no `eval`, no `new Function`, no dynamic `import` of anything but Node's own modules, no `require` of a repository file.
* **No network.** No module of the hook or the engine imports `http`, `https`, `net`, `tls`, `dns` or `dgram` or calls `fetch`. The hook tests run with all of them replaced by functions that throw.
* **No write into the repository.** The working tree is read through a temporary index and object directory.

**Agent controlled payloads.** Each agent's parser is fuzzed with damaged fixtures and with arbitrary JSON under the keys it reads. It returns a well formed event or throws, and a throw allows the action with a note. The answer renderer never turns "allow" into a block or the other way round.

The command scanner was the serious finding here (F2). It was one regular expression, exponential in the number of git options. A 150 character command line hung the hook before its timeout was armed, because the parse ran first and a regular expression blocks the timer. The harness then kills the hook and lets the action through. It is a scanner now, linear, and it agrees with the old expression on 10,000 generated command lines (`events.fuzz.test.ts`).

**State directory.** The loop guard counts blocks in `$TMPDIR/testwitness-hook-<uid>/`, never in the repository. The directory must be a real directory, owned by the user, and writable by nobody else (the last condition is new, F16). File names are hashes of the repository path and the session id, so neither can steer the path.

**Loop guard.** The same finding blocks at most `hook.max_blocks` times per session (default 2), then the hook allows the action and tells the user. If the state cannot be written, nothing is blocked. This is deliberate: an agent that cannot proceed is worse than a finding a person sees later.

**What the hook is not.** It is not a sandbox. It fails open by design: on a crash, on a timeout (20 seconds by default), and when the loop guard steps aside. An agent that can run shell commands can make the check slow, can write to the state directory (same user), can use `git commit --no-verify` where the harness lets it, or can simply not be configured with the hook. Each of those paths ends in a visible note to the user, except the last. The pull request check is the gate; the hook is an early warning.

## The MCP server

`testwitness mcp` serves three read only tools over stdio. Two of them list and explain rules and take no path.

What a malicious client can make `testwitness_check` do:

* Run the check on any git repository the user can read. That is what the tool is for. It writes nothing except the helper index cache in the user's temp directory.
* Pass `base` and `head`. They must not start with a dash or contain whitespace, so they cannot become git options, and they are resolved with `rev-parse --verify` before use.
* Pass report globs. They must be relative, without `..` (F17). Links are not followed.
* Pass PR text up to 210,000 characters. It is only matched against patterns.

What a malicious repository can make it do:

* Supply the config on its own base branch. In a clone, the "base" is whatever `origin/HEAD` points to, which the repository's owner controls. That config can turn rules off (it is their repository) and can name report globs with an absolute path, which the server will read as reports. The readers quote very little of a file they cannot parse (a line after `Bail out!`, a few characters of a JSON syntax error), so the leak is small, and it goes to the agent that asked, which can usually read files anyway. Listed under known limits.
* Put instructions for the model into test names. See "Text meant for a model" above.

The server makes no network call and starts only `git`.

## Fuzzing

Each target runs 10,000 generated cases from a fixed seed (20261113) inside the normal test suite, so a failure reproduces. A case that throws, rejects, breaks a stated property or takes more than 2 seconds fails the target. Set `TESTWITNESS_FUZZ_RUNS` to run more, `TESTWITNESS_FUZZ_SEED` to explore other inputs. Inputs are built two ways: valid seed documents with random deletions, duplications, insertions and truncations, and values generated from the shapes and keywords the reader looks at. The inserted text comes from a list of about 120 hostile fragments (line breaks of every kind, escape sequences, bidirectional and invisible characters, mentions, links, HTML, Markdown, workflow commands) mixed with arbitrary Unicode including unpaired surrogates.

| Target | Cases | Seconds | Test file |
|---|---|---|---|
| action log line | 10,000 | 0.6 | `packages/action/src/annotations.fuzz.test.ts` |
| annotation writer | 10,000 | 1.2 | `packages/action/src/annotations.fuzz.test.ts` |
| hook answer renderer | 10,000 | 0.5 | `packages/cli/src/hook/events.fuzz.test.ts` |
| hook event parser, claude | 10,000 | 0.9 | `packages/cli/src/hook/events.fuzz.test.ts` |
| hook event parser, codex | 10,000 | 0.7 | `packages/cli/src/hook/events.fuzz.test.ts` |
| hook event parser, cursor | 10,000 | 0.8 | `packages/cli/src/hook/events.fuzz.test.ts` |
| hook event parser, git | 10,000 | 0.8 | `packages/cli/src/hook/events.fuzz.test.ts` |
| hook git command scanner | 10,000 | 0.1 | `packages/cli/src/hook/events.fuzz.test.ts` |
| diff rename and quoted paths | 10,000 | 1.5 | `packages/core/src/diff/parse.fuzz.test.ts` |
| diff unquote | 10,000 | 0.3 | `packages/core/src/diff/parse.fuzz.test.ts` |
| unified diff parser | 10,000 | 0.6 | `packages/core/src/diff/parse.fuzz.test.ts` |
| cobertura reader | 10,000 | 1.9 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| config loader (YAML) | 10,000 | 2.9 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| history reader | 10,000 | 0.4 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| jacoco reader | 10,000 | 1.7 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| lcov reader | 10,000 | 1.9 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| pit reader | 10,000 | 1.9 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| stryker reader | 10,000 | 0.7 | `packages/core/src/evidence-readers.fuzz.test.ts` |
| json report | 10,000 | 3.6 | `packages/core/src/report/render.fuzz.test.ts` |
| markdown codeCell | 10,000 | 2.0 | `packages/core/src/report/render.fuzz.test.ts` |
| markdown esc | 10,000 | 4.4 | `packages/core/src/report/render.fuzz.test.ts` |
| markdown report | 10,000 | 35.0 | `packages/core/src/report/render.fuzz.test.ts` |
| sanitiser | 10,000 | 0.4 | `packages/core/src/report/render.fuzz.test.ts` |
| text report | 10,000 | 3.8 | `packages/core/src/report/render.fuzz.test.ts` |
| jest json reader | 10,000 | 0.7 | `packages/junit/src/readers.fuzz.test.ts` |
| json readers, shaped values | 10,000 | 0.7 | `packages/junit/src/readers.fuzz.test.ts` |
| junit xml reader | 10,000 | 3.1 | `packages/junit/src/readers.fuzz.test.ts` |
| playwright json reader | 10,000 | 1.0 | `packages/junit/src/readers.fuzz.test.ts` |
| pytest json-report reader | 10,000 | 1.1 | `packages/junit/src/readers.fuzz.test.ts` |
| tap reader | 10,000 | 1.8 | `packages/junit/src/readers.fuzz.test.ts` |
| vitest json reader | 10,000 | 0.7 | `packages/junit/src/readers.fuzz.test.ts` |

Total: 310,000 cases in 78 seconds on the review machine.

What the fuzzers found, each now a regression test next to the code:

* `unquote` threw on a quoted path that ends in a backslash (F13).
* A link survived escaping when its scheme had no word boundary in front (`%25http://host`), part of F3.
* The config loader threw the YAML parser's own error types instead of `ConfigError` (F12).
* The Markdown structure property (same document shape as with harmless text, checked with an independent CommonMark parser) caught that a note could start a list or a rule, part of F3.

What they did not find: no crash or hang in any results, coverage, mutation or history reader, and no way to inject a line or a command through the annotation writer.

The fuzzers do not cover the tree-sitter front ends (they have their own edge tests, and L1 below was found by hand), the rules themselves, or GitHub's real Markdown renderer. The Markdown properties are checked against the escaping rules and against markdown-it, not against github.com.

## Findings of this review

Severity is for a repository that runs the Action on pull requests from forks, or a developer who runs the hook.

| # | Severity | Finding | Status | Test that proves the fix |
|---|---|---|---|---|
| F1 | high | A pull request against a repository without `.testwitness.yml` could add one and switch off every rule, W006 included (Action, CLI, MCP). | fixed | `packages/cli/src/config-source.test.ts` |
| F2 | high | Hook: the `git commit` detector was exponential. A 150 character command hung the hook, and the harness then let the action through. | fixed | `packages/cli/src/hook/events.fuzz.test.ts` |
| F3 | medium | Markdown: `&#64;name` and `https&colon;//host` went around the mention and link escaping; a link without a word boundary before its scheme survived; a lone CR or U+2028 ended a table row; control and bidirectional characters, issue references, block starts and unbounded length were not handled. | fixed | `packages/core/src/report/render.fuzz.test.ts` |
| F4 | medium | Action log: a file name with a line break, quoted in a log line, could start a workflow command (`::stop-commands::`, `::add-mask::`, a forged `::error::`). | fixed | `packages/action/src/annotations.fuzz.test.ts` |
| F5 | medium | Output files were written through a symbolic link the pull request committed (`testwitness.json`, `testwitness.md`, the history, `.testwitness-pr-body.txt`, CLI `--out`). | fixed | `packages/core/src/safe-write.test.ts`, `packages/cli/src/hostile-repo.test.ts` |
| F6 | medium | A deeply nested YAML runner config in the pull request aborted the process inside the parser. In the hook a crash lets the action through. | fixed | `packages/core/src/hostile-input.test.ts`, `packages/cli/src/hostile-repo.test.ts` |
| F7 | medium | About 35 regular expressions were quadratic or worse on text the pull request controls (table above). | fixed | `packages/core/src/hostile-input.test.ts`, `packages/junit/src/readers.fuzz.test.ts`, `packages/lang-python/src/hostile-input.test.ts`, and others named above |
| F8 | medium | An acknowledgement comment counted from any organisation member or read only collaborator. | fixed | `packages/action/src/acknowledge.test.ts` |
| F9 | low | The Action adopted any comment that contained its marker and wrote the report into it. | fixed | `packages/action/src/annotations.fuzz.test.ts` |
| F10 | low | A rule or a parser that threw left only a log line; the report read as if nothing was wrong. It is a note at the top of the report now. | fixed | `packages/cli/src/hostile-repo.test.ts` |
| F11 | low | One warning per XML error without a cap: memory grew with the file. | fixed | `packages/junit/src/readers.fuzz.test.ts`, `packages/core/src/evidence-readers.fuzz.test.ts` |
| F12 | low | Invalid YAML in the config, or an alias bomb, threw the parser's error types instead of `ConfigError`. | fixed | `packages/core/src/evidence-readers.fuzz.test.ts` |
| F13 | low | `unquote` threw on a trailing backslash. | fixed | `packages/core/src/diff/parse.fuzz.test.ts` |
| F14 | low | Bidirectional and invisible characters reached the terminal, the hook answer and the MCP summary; the git pre-push reason reached the terminal with raw escape sequences; JSON held raw C1 and bidirectional characters. | fixed | `packages/core/src/report/render.fuzz.test.ts`, `packages/cli/src/hook/events.fuzz.test.ts`, `packages/cli/src/mcp.test.ts` |
| F15 | low | Readers: `time="1e999"` became Infinity; a fractional Jest invocation count became fractional reruns; a Stryker status named `constructor` counted as a mutant. | fixed | `packages/junit/src/readers.fuzz.test.ts`, `packages/core/src/evidence-readers.fuzz.test.ts` |
| F16 | low | Hook state directory: a directory writable by others was accepted. | fixed | `packages/cli/src/hostile-repo.test.ts` |
| F17 | low | MCP: report globs could be absolute or climb with `..`. | fixed | `packages/cli/src/mcp.test.ts` |
| F18 | low | A report rendered from a JSON file (the `workflow_run` pattern) was not escaped in its non text fields. | fixed | `packages/core/src/report/render.fuzz.test.ts` |
| F19 | low | The parse error count walked children by index, quadratic on a node with many children. Found while looking into L1; it does not fix L1. | fixed | none of its own; covered by the existing front end tests |
| L1 | medium | **Open.** Test source with tens of thousands of unclosed brackets is read in quadratic time: 30,000 take about 6 seconds, 100 kB took 77 seconds through the whole check. The time is spent inside tree-sitter's query engine on a tree as deep as the brackets. In CI this burns minutes; in the hook it runs into the timeout, which allows the action with a note. Not fixed because the two small fixes change what the check reports: refusing the file hides its tests from the rules, and a time limit makes the result depend on the machine. | open | `packages/lang-ts/src/hostile-input.test.ts` (`it.fails`) |

## Known limits

These are not bugs to be fixed in the code. They are where the model stops.

* **L1** above.
* **Evidence is self reported.** Test results, coverage and mutation reports are written by the pull request's own run and can be forged. See "History and mutation artifacts".
* **The workflow file belongs to the pull request** on `pull_request` events. See "Fork pull requests".
* **Self hosted runners that are reused between jobs.** An earlier job that ran pull request code can leave anything in the temp directory, including a forged helper index cache (`$TMPDIR/testwitness-helper-index-<uid>`), which decides which helper calls count as assertions. Use ephemeral runners, or set `TESTWITNESS_HELPER_INDEX=off`.
* **The hook fails open** and is not a sandbox. See "The hook".
* **An untrusted clone's base config** can name report globs outside the repository for the MCP server. See "The MCP server".
* **Visible instructions in quoted text** reach a model through the hook and the MCP server.
* **The comment is cut at 60,000 characters.**
* **The ReDoS scan and the fuzzers are searches.** They show the absence of the problems they looked for on the inputs they tried.
