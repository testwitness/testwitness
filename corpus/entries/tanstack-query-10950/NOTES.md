# TanStack/query#10950

Adds a renderWithClient helper to solid-query test utils and replaces inline QueryClientProvider wrapping in eleven test files, deleting about 1200 lines of boilerplate. Assertions are untouched. Honest extraction of setup, not assertions. Stresses large deletion heuristics that treat removed lines in test files as lost coverage.
