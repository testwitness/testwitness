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
  extra:                # custom assertion helpers that live outside the test file
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

Unknown rule ids and options are errors, not silently ignored. Changing a rule's severity shifts every finding of that rule by the same number of steps.

Fingerprints are in `testwitness.json` next to each finding and survive line shifts and rebases.
