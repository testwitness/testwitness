# TanStack/query#10679

Adds tests for the devtools component, among them a render without throwing smoke test whose oracle is expect(...).not.toThrow. The engine reports O002 low smoke. Intentional smoke test; honest control for O001 and O002.
