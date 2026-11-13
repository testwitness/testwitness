# PrefectHQ/prefect#18450

Migrates integration scripts from a custom runner to pytest: flows/*.py become integration-tests/test_*.py and their entry functions become test functions. Two of them keep a try/except Exception that prints and returns False; under pytest a returned False passes, and the runner_resilience script used to exit 1 through main() when it got False. Both new tests can no longer fail on the errors they catch. Weakened in the new tests (the load_flows script never failed CI before either). Stresses E001 on catch blocks carried into newly collected tests.
