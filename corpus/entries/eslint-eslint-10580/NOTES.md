# eslint/eslint#10580

Simplifies the getVariable helper in Linter tests to return the found variable or null instead of iterating manually. No test or assertion changes. Honest helper cleanup. Stresses rules that fire on any edit to a helper used by assertions.
