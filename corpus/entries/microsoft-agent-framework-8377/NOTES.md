# microsoft/agent-framework#8377

Temporarily skips a flaky C# integration test (one line). The PR body ticks the checklist item claiming new tests were added, while the diff adds no test and in fact disables one. The skip itself is in C#, which the engine does not parse, so only the claim is labelled. Stresses V004 on a PR that weakens tests while claiming to add them.
