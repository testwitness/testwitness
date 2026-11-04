# pydantic/pydantic-core#817

Adds continue-on-error: true to the test-pydantic-integration job (which runs the pydantic test suite against this build with pdm run pytest) and removes it from the alls-green needs list. Integration test failures no longer fail CI. Stresses W002 on a literal true at job level.
