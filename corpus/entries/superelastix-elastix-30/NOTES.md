# SuperElastix/elastix#30

Appends || true to the AppVeyor build line that ends in ctest, so failing tests no longer fail the Windows CI run; the title says the tests should always return exit code 0. appveyor.yml is not in the workflow globs, so files.py does not copy it; its base and head versions were copied unedited from the git mirror so the engine can see the change. The engine currently misses it because appveyor.yml is not treated as a command file. Stresses W003 on || true after a test command in a CI file other than GitHub Actions.
