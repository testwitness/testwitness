# microsoft/playwright-java#1038

Replaces try { ...; fail("did not throw") } catch (PlaywrightException e) { assertNotNull(e) } with assertThrows across 51 test files. The engine reports A001 medium on two tests that lost fail and assertNotNull: false positives, since assertThrows enforces the same thing. Honest migration.
