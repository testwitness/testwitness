# Security

testwitness runs on `pull_request` with `contents: read`, needs no secrets, makes no network calls, and never executes the code of the repository it scans. Nothing leaves the runner.

If you find a vulnerability, email the maintainer privately (address in the repository profile) instead of opening an issue. You will get a reply within 7 days and a fix or a public note within 90 days. Reports about a rule being wrong are not security issues; open a false positive or missed detection issue instead.

## Security model and known limits

testwitness reads pull requests from people it has no reason to trust, including pull requests from forks, and writes a comment that reviewers do trust. The full analysis, with the code and the test behind each statement, is in [docs/threat-model.md](docs/threat-model.md). This section is the summary.

### What is defended, and how

**A pull request cannot relax its own check.** `.testwitness.yml` is read from the merge base. A config that the pull request adds or changes is never read, by the Action, the CLI, the agent hook or the MCP server. Changes to the config, to the workflow step and to the agent hook config are reported as W006, which only someone with write access can acknowledge, by a comment. Acknowledgements by comment or label count only from people with write or admin permission who are not the author of the pull request.

**Text from a pull request cannot speak in the bot's voice.** Test names, file paths, PR text, assertion text and the contents of result files are escaped for every output:

* In the comment and the job summary they cannot mention anyone, link anywhere, reference an issue, add HTML, or break out of a table cell or a code span. Control characters, bidirectional overrides and invisible characters are replaced, and long text is cut.
* In the step log they cannot start a workflow command. Annotations are written through `@actions/core`, and every other log line is one line of safe characters behind a fixed prefix.
* In the terminal, in the hook's answer and in the MCP summary they cannot send escape sequences.
* In the JSON report they are data. Anything that renders the JSON must escape it; `renderMarkdown` does.

**No code from the repository runs.** No install, no test run, no `require` or `import` of a repository file. Configs are parsed as text and source is parsed by bundled tree-sitter grammars. The only program testwitness starts is `git`, with local subcommands, without external diff, textconv or hooks. A test traces every child process on a repository full of traps.

**No network calls from the engine, the CLI, the hook or the MCP server.** The Action calls the GitHub API with the job token for the comment and the acknowledgements, and nothing else.

**Files.** Result files are found by globs that come from the workflow or the base config, never from the pull request. Symbolic links are not followed unless the base config says so. Output files are not written through a symbolic link.

**Hostile input does not take the check down.** XML entities are not expanded and external entities are not resolved. Reports are read within file and byte caps. Nesting in XML, JSON and YAML is bounded. Every regular expression in the source was run against 100 kB of adversarial input, and the ones that were slow were replaced.

### What is out of scope

* **A workflow that gives pull request code a write token or secrets.** If you run the check on `pull_request_target` and check out the pull request's head, every install and test step in that job runs untrusted code with your secrets. testwitness does not execute that code, and it cannot stop the other steps from doing so. Use `pull_request`.
* **An attacker with write access.** They can change the config on the base branch, the workflow and the branch protection, and they can acknowledge findings.
* **A pull request that edits the workflow so testwitness no longer runs.** On `pull_request` events GitHub takes the workflow file from the pull request. Make the check required, and run it from a workflow the pull request cannot edit if the gate matters to you.
* **Forged test results.** Result files are written by the pull request's own test run, and testwitness cannot tell a forged one from a real one. The rules that read the diff do not depend on them.
* **The agent hook as a sandbox.** The hook is an early warning in a coding agent's loop. It fails open on a crash, on its timeout and after it has blocked the same finding twice, and it says so each time. An agent with a shell can get around it. The pull request check is the gate.
* **Runners reused between jobs.** State in the temp directory of a self hosted runner that earlier pull request code could write is not trusted input. Use ephemeral runners.
* **What a model does with quoted text.** The hook and the MCP server quote test names and test code to a coding agent. Invisible characters are removed; visible sentences are not.

### Known limits

* One denial of service is open. A test file with tens of thousands of unclosed brackets is read in quadratic time (about 6 seconds for 30,000, 77 seconds for 100 kB). The check finishes and the findings are right, but it is slow. It is tracked by a failing test, `packages/lang-ts/src/hostile-input.test.ts`.
* The comment is cut at 60,000 characters. The JSON report has every finding.
* The MCP server reads the config of the repository's own base branch. In a repository you do not trust, that config can name report files outside the repository.
* The escaping was tested against the CommonMark rules and an independent parser, not against github.com itself.

### Fuzzing

The review of November 2026 fuzzed 31 targets with 10,000 generated cases each, 310,000 cases in all, in 78 seconds of fuzzing time. The targets: the unified diff parser and git's quoted and renamed paths; the JUnit XML, TAP, Jest, Vitest, pytest-json-report and Playwright readers; the lcov, Cobertura and JaCoCo readers; the Stryker and PIT readers; the history reader; the YAML config loader; the Markdown, text and JSON renderers; the annotation writer and the Action's log lines; and the hook event parser of each agent with its command scanner and answer renderer. A case fails when it throws, takes more than 2 seconds or breaks a stated property, for example that a rendered report has the same structure as the same report with harmless text. The fuzzers found four bugs, all fixed with a regression test. Six of those targets (the lcov, Cobertura, JaCoCo, Stryker, PIT and history readers) belonged to features that were cut from v0.1 and are no longer in the package. Separately, every one of the 556 regular expressions in the source was run against about 1,400 adversarial inputs of 100 kB; the ones that were quadratic or worse were replaced. The table of targets with counts and times is in [docs/threat-model.md](docs/threat-model.md#fuzzing).

The fuzz targets run in the normal test suite (`pnpm test`) from a fixed seed. `TESTWITNESS_FUZZ_RUNS=100000 pnpm vitest run --project unit fuzz` runs more cases. The ReDoS scan is `node scripts/security/redos-scan.mjs`.

Fuzzing and scanning are searches. They show that the problems looked for were not found on the inputs tried, not that none exist.
