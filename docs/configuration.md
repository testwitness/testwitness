# Configuration

Optional `.testwitness.yml` at the repository root. In PR mode it is read from the base ref, so a PR cannot relax its own check; any change to the file is reported under W006 and takes effect after merge.

```yaml
version: 1
mode: report            # report | require-ack | strict
fail_on: high           # strict and require-ack only: high | medium | low
require_evidence: false # strict only: an unreadable run fails the check
languages: [java, typescript, python]   # default: auto detect
paths:
  tests:                # override test file detection
    - "src/test/**"
    - "**/*.test.ts"
  ignore:
    - "**/generated/**"
  followSymlinks: false # follow symbolic links in results, coverage, mutation and history paths (see below)
results:                # test results of the head run; `junit` is the older name of this key and still works
  head: "**/junit*.xml"  # JUnit XML, TAP, or Jest, Vitest, pytest-json-report or Playwright JSON (docs/evidence.md)
coverage:
  paths:                # lcov, Cobertura or JaCoCo XML of the head run; empty: V008 is off
    - "coverage/lcov.info"
    - "**/jacoco.xml"
mutation:
  paths:                # Stryker mutation.json or PIT mutations.xml from the opt in mutation job; empty: M001 and M002 are off
    - "reports/mutation/mutation.json"
    - "**/pit-reports/mutations.xml"
assertions:
  extra:                # helpers outside the scanned support files, or without an assertion inside
    - "assert_ledger_balanced"
    - "com.acme.test.Check#*"
rules:
  R003: high            # per rule severity: high | medium | low | off
  T001: off
acknowledge:
  - fingerprint: "R003:src/test/java/com/acme/PaymentsIT.java:PaymentsIT#pollsSettlement"
    reason: "needs a live sandbox, tracked in PAY-412"
    by: sajjad
    date: 2026-11-20
provenance:
  show: true
  stricter_for_agents: false
claims:
  enabled: true
  phrases_extra: ["ran the full suite"]
comment:
  enabled: true
  collapse_low: true
protect:                # agent hook only: paths a coding agent may not change (docs/agent-guard.md); default none
  - "tests/golden/**"
hook:                   # agent hook only
  timeout: 20           # seconds before the hook gives up and allows the action
  max_blocks: 2         # how often the same finding may block in one agent session
  blocking: [A002, C001, C002, R004, R005, W003, W006]   # the rules the hook may block on; the default is the set the replay has proven (docs/precision.md)
  advice_only: []       # rules taken off the blocking list again
```

`protect` and `hook` are read by the [agent guard](./agent-guard) only, and only from the merge base, never from the working tree. The pull request check ignores them.

## Symbolic links in report paths

::: v-pre
The results, coverage, mutation and history paths do not follow symbolic links by default. A matched file that is itself a link, or that lies outside the repository through a linked directory, is skipped with a note in the report. Otherwise a pull request could commit `test-results/a.xml` as a link to any file on the runner and have the check read it. A glob that names a directory outside the repository on purpose (an absolute path such as `${{ runner.temp }}/reports/**/*.xml`, or a `../` path) may read files under that directory.
:::

Layouts that link their outputs into the checkout need the links followed. Bazel is the common case: `bazel-testlogs` is a link into the output base.

```yaml
paths:
  followSymlinks: true
results:
  head: "bazel-testlogs/**/test.xml"
```

On the CLI the same switch is `--follow-symlinks`. Turn it on only where the links are made by the build, not by the pull request.

## The acknowledgement label

The `testwitness:acknowledged` label acknowledges every open finding except W006. The Action reads who applied it from the pull request's issue events (the most recent `labeled` event for the label) and honours it only when that person is not the pull request author and has write or admin permission on the repository: an owner, a member or a collaborator with write access. Triage access, which can add labels, is not enough. When the events or the permission cannot be read (a token without access, an API error), the label is ignored and the log says so. The reason shown is the labeller's most recent comment on the pull request.

## Assertion helpers and `assertions.extra`

Most projects need no `assertions.extra`. A call from a test counts as an assertion when the callee is:

1. a framework assertion, an exception expectation or a snapshot;
2. named like an assertion (`assert*`, `check*`, `verify*`, `expect*`, `should*`, `validate*` in Java and TypeScript, `assert*` in Python);
3. a helper defined in the same test file whose body asserts;
4. a helper defined in a test support file of the checkout whose body asserts, or calls another helper that asserts. testwitness indexes these files itself (the helper index, see [design.md](./design.md#helpers-in-other-files)). The scanned locations are files under any directory named `test`, `tests`, `__tests__`, `spec`, `testing`, `test-utils`, `testutils` or `fixtures`, every `conftest.py`, and `src/test/**` for Java.

`assertions.extra` is now only for helpers the index cannot see or cannot read as asserting:

- the helper lives outside those locations, for example `src/main/java/.../TestSupport.java`, a published test kit in `node_modules` or site-packages, or a shared module in another repository;
- the helper fails in a way that is not an assertion the front end reads, such as a plain `throw new Error(...)` or `raise AssertionError(...)` in a branch;
- the index stopped at its cap (2,000 files or 50 MB of support files); the report says so under Helpers in other files.

An entry is the helper name as a bare call uses it (`assert_ledger_balanced`); Java also accepts the receiver and name (`Check.balanced`).

The index never imports or runs repository code; it only parses files. To turn it off for one run, set the environment variable `TESTWITNESS_HELPER_INDEX=off`.

## Rule ids and fingerprints

Unknown rule ids and options are errors, not silently ignored. Changing a rule's severity shifts every finding of that rule by the same number of steps.

Fingerprints are in `testwitness.json` next to each finding and survive line shifts and rebases.
