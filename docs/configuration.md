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
junit:
  head: "**/junit*.xml"
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
```

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
