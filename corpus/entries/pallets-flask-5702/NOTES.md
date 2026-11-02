# pallets/flask#5702

Deletes the limit_loader fixture (which parametrised three tests to run twice, once with a mocked pkgutil loader) and drops it from the tests, because pkgutil.get_loader is no longer used. The production change landed in an earlier release. Honest removal of obsolete coverage. Stresses parameter count rules on fixture driven parametrisation and removal rules with no production change in the PR.
