# nrwl/nx#2442

Fixes a migration of the Nx jest plugin that inserted passWithNoTests into project jest configs and adds a corrective migration with test fixtures. The engine reports C003 high on passWithNoTests in a migration test fixture (test-files/jest.config.js), not in the repository's own config: a false positive. Honest control for C003.
