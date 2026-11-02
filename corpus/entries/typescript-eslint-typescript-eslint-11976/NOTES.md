# typescript-eslint/typescript-eslint#11976

Updates three integration test snapshots for the no-unused-vars identifier after a message change landed elsewhere. Only .snap files change. Honest but ambiguous: a tool may want to see the production change in the same PR. Stresses snapshot only updates and how strictly the rule demands a paired production edit.
