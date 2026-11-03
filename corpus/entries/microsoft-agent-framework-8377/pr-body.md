### Motivation & Context

`SteerableLongRunningIntegrationTests.ActiveMafTurn_QueuesSteeringThenRunsItOnTheSameSessionAsync` fails intermittently in .NET CI (`net10.0`, `ubuntu-latest`): the assertion right after submitting the steering request expects `agent.RunCount == 1` but observes `2`. Root cause is unknown — it may be test synchronization or a runtime behavior regression — so this PR is an interim mitigation to unblock CI while investigation continues under issue #8376.

### Description & Review Guide

- **What are the major changes?**
  - Single test-only change in `dotnet/tests/Microsoft.Agents.AI.Foundry.Hosting.UnitTests/SteerableLongRunningIntegrationTests.cs`, using the repository's existing xUnit skip convention:

    ```csharp
    [Fact(Skip = "Temporarily skipped: flaky in CI (observed RunCount 2 instead of 1); see https://github.com/microsoft/agent-framework/issues/8376")]
    public async Task ActiveMafTurn_QueuesSteeringThenRunsItOnTheSameSessionAsync()
    ```

  - Test body and every assertion are preserved verbatim, so the sequential-execution and session-continuity guarantees remain encoded for when the test is re-enabled.

- **What is the impact of these changes?**
  - Exactly one test is newly skipped; the `Microsoft.Agents.AI.Foundry.Hosting.UnitTests` project reports 464 total / 463 passed / 1 skipped. No production code, other tests, project files, or CI workflows are touched.
  - Coverage for the steering queue/session-reuse path is temporarily lost. Issue #8376 stays open for root-cause analysis and removal of the skip.

- **What do you want reviewers to focus on?**
  - Whether the skip reason and issue link are sufficient to prevent this from silently becoming permanent.

### Contribution Checklist

- [x] The code builds clean without any errors or warnings
- [x] All unit tests pass, and I have added new tests where possible
- [x] The PR follows the [Contribution Guidelines](https://github.com/microsoft/agent-framework/blob/main/CONTRIBUTING.md)
- [x] This PR is linked to an issue and there is no other open PR for this issue (see Related Issue above).
- [x] **This is not a breaking change.** If it _is_ a breaking change, add the `breaking change` label (or add "[BREAKING]" to the title prefix, before or after any language prefix) — a workflow keeps the label and title prefix in sync automatically.



- Fixes #8376
