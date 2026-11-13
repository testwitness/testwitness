# googleapis/google-cloud-python#17607

In four packages, removes --fail-under from the nox coverage session and sets fail_under in .coveragerc instead. The effective gate drops from 100 to 99 (google-api-core, google-cloud-ndb) and 100 to 98 (sqlalchemy-bigquery). For django-google-spanner the nox session already enforced 80, so moving 80 into .coveragerc (which said 100) changes nothing; the engine reports C002 medium for it because it does not read the noxfile value, a false positive. Stresses C002 when a threshold moves between a noxfile command and .coveragerc.
