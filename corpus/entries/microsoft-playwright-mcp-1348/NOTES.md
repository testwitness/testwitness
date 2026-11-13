# microsoft/playwright-mcp#1348

Deletes cli.spec.ts, whose two tests checked that the CLI prints help and its version. The CLI stays and no other test covers those outputs in the diff. Weakened. Stresses R002 on a deleted spec file.
