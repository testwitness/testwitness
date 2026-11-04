# apache/doris#51134

Adds -Dmaven.test.failure.ignore=true to the mvn test jacoco:report command that run-fe-ut.sh runs for frontend unit tests with coverage, so failing tests no longer fail the script. The script is a .sh file, which files.py does not copy by default; its base and head versions were copied unedited from the git mirror so the engine can see the change. The engine currently misses it because shell scripts are not treated as command files. Stresses W003 on a Maven failure ignore flag in a shell script.
