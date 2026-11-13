# langflow-ai/langflow#5730

Reworks the maintenance workflow that measures test durations and commits the durations file: the pytest step is limited to unit tests and marked continue-on-error so a failing test does not stop the durations update. The workflow is not a CI gate; tests are gated by the main test workflow. The engine reports W002 high on the step: a false positive for a non gating maintenance job. Honest control.
