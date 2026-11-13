# apache/doris#65749

Changes the cloud unit test runner script so a gtest binary that fails with an AddressSanitizer report inside libfdb_c.so is treated as passing (last_ret=0). Failures matching that pattern no longer fail CI. cloud/script/run_all_tests.sh is a shell script the engine does not read as a command file (missed). files.py does not copy it; its base and head versions were copied unedited from the git mirror. Stresses W003 on exit code rewriting in a shell runner.
