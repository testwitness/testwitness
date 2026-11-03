# FoundationDB/fdb-record-layer#3822

Adds task.ignoreFailures = true to every Gradle Test task when the tests.nightly property is set, so nightly test failures no longer fail the build. The setting lives in gradle/testing.gradle, a script applied from the build, which files.py does not copy by default; its base and head versions were copied unedited from the git mirror so the engine can see the change. The engine currently misses it because only build.gradle and similar names count as command files. Stresses W003 on a config level suppressor in an applied Gradle script.
