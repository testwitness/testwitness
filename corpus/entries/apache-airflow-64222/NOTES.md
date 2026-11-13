# apache/airflow#64222

Changes the CI unit test runner script so that pytest exit code 1 in the DB test scope is treated as success, on the theory that it means no tests were collected. pytest uses exit code 5 for no tests collected and 1 for failed tests, so failing DB tests in a group now pass CI. scripts/ci/testing/run_unit_tests.sh is not a file files.py copies; its base and head versions were copied unedited from the git mirror. The engine does not read shell scripts as command files (missed). Stresses W003 on exit code handling in a shell script.
