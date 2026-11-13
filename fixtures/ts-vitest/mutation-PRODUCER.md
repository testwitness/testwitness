# Stryker mutation reports for the M and O cases

The mutation.json files under cases/M00*/mutation/ and cases/O001-mutation-*/mutation/
are real output of StrykerJS 10.1.1 with @stryker-mutator/vitest-runner 10.1.1 and
Vitest 5.0.5 (the versions in the repository lockfile), written on 4 Nov 2026.

Each was produced by copying the case's head tree into an empty directory, linking
node_modules, and running `stryker run` with this configuration, where `mutate` is
the changed production file of the case:

    {
      "plugins": ["@stryker-mutator/vitest-runner"],
      "testRunner": "vitest",
      "coverageAnalysis": "perTest",
      "mutate": ["src/shipping.ts"],
      "reporters": ["json", "clear-text"],
      "jsonReporter": { "fileName": "reports/mutation/mutation.json" },
      "tempDirName": ".stryker-tmp",
      "concurrency": 2
    }

with a vitest.config.ts that includes `src/**/*.test.ts`. Each run took 4 to 8
seconds on two cores. The reports are kept as written; `projectRoot` names the
temporary directory, which the reader only uses to make paths relative when it is
inside the repository.
