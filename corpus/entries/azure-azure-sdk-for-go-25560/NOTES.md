# Azure/azure-sdk-for-go#25560

Lowers the CoverageGoal of the azopenai package in eng/config.json from 0.16 to 0.10 and drops two entries with a goal of 0, so live pipelines pass while coverage is improved. Weakened gate in a repository specific config file the engine does not read (missed). Stresses C002 outside the standard coverage formats.
