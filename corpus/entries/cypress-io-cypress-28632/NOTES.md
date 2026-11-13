# cypress-io/cypress#28632

Adds logging tasks to debug hanging tests and comments out two tests that were already it.skip. No running test is removed, so coverage does not change. The engine reports R001 medium on the two commented out tests: false positives, since they did not run in the base either. Honest control.
