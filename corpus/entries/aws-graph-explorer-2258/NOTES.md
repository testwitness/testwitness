# aws/graph-explorer#2258

Removes the Vitest coverage thresholds (statements 65, branches 44, functions 58, lines 73) and switches the CI step from pnpm coverage to pnpm test, so coverage is no longer collected or gated. Weakened gate. Stresses C002 on thresholds removed outright.
