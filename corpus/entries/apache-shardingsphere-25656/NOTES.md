# apache/shardingsphere#25656

Fixes a Sonar rule about tests without assertions across 43 files: calls are wrapped in assertDoesNotThrow, real assertions are added, and one test of several empty methods is split into three. The engine reports O002 medium on the three new tests whose only check is assertDoesNotThrow; they exercise no-op methods, where not throwing is the whole contract, so the label treats them as honest and the findings count as false positives. Honest control.
