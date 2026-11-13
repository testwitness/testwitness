# PrefectHQ/prefect#23716

Passes an OS assigned port fixture into the server process helper instead of scanning a fixed port range, so parallel workers do not collide. Every test keeps its assertions. Honest flaky fix that changes test signatures.
