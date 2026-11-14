# How it decides

## Three states

- `pass`: no open finding at or above `fail_on` (default `high`).
- `review`: this PR changed what its tests prove. A reviewer should look.
- `unreadable`: the diff rules ran and found nothing, but no JUnit XML was available to confirm what ran, and the PR touched tests or test configuration.

testwitness never says a PR lied. A claim it cannot check is reported as unreadable, with the reporter to turn on.

## Severities

- `high`: test integrity was very likely reduced. Drives `review`.
- `medium`: needs a reviewer's eye. Counted and shown.
- `low`: informational. Collapsed in the comment. Moved, parameterised, refactored, conditional, smoke, tracked.

In v0.1 only the proven rules give medium or high: R003 (test newly skipped), R004 (test turned into an expected failure), R005 (focused test added) and A002 (assertion loosened). Every other rule still runs, and its findings are shown at low until it passes an untuned replay ([how we measure precision](./how-we-measure-precision#proven-and-unproven-rules)). W006, a change to the gate itself, is the one exception.

Every rule's default can be changed per repository (for a rule that is not proven yet, naming a severity opts it back in; see [configuration](./configuration#proven-rules-and-the-cap-at-low)), and any finding can be acknowledged with a reason.

## Modes

- `report` (default): the check always passes; findings are shown.
- `require-ack`: the check fails while a finding at or above `fail_on` is not acknowledged.
- `strict`: like `require-ack`, and with `require_evidence: true` an unreadable run also fails.

## Acknowledging a finding

Three ways, any of which clears it:

1. A comment on the PR by someone with write or admin permission on the repository who is not the PR author (the Action looks the permission up; being a member of the organisation is not enough):
   `/testwitness ack R003 PaymentsIT#pollsSettlement reason: needs a live sandbox, see PAY-412`
   or `/testwitness ack all reason: test only refactor`.
2. The label `testwitness:acknowledged`, with the reason taken from the most recent comment by a maintainer.
3. A fingerprint in `.testwitness.yml` for permanent acknowledgements, merged through review.

W006 (the gate itself changed) can only be acknowledged by the comment command from a maintainer. Acknowledged findings stay in the JSON with who, why and when.

## Diff scoped

Rules only look at what the PR changed. Pre existing skipped tests, assertion free tests or catch alls in the base produce nothing.

## Exit codes (CLI)

0 pass or report mode; 1 review in require-ack or strict mode; 2 tool error; 3 unreadable in strict mode with `require_evidence`.
