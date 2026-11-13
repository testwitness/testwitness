# TanStack/query#10624

Sets up Vitest with testing-library for the Svelte devtools package and adds a smoke test that asserts the rendered container. The engine reports O006 medium on tests/test-setup.ts, a setup file with no tests by design: a false positive. Honest control.
