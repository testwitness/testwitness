# apache/airflow#59542

Moves the Dag trigger e2e test from its own spec file into dags-list.spec, reusing the page object. The test body and its expectations are carried over. Honest move between files.
