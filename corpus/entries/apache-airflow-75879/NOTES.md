# apache/airflow#75879

Folds five Spark sensor waiting state tests (not processed, new, running, submitted, pending rerun) into one parametrised test. The single body keeps the poke and mock call assertions, with ANY added for the autospec self argument. Honest parametrised fold. Stresses R001 with five deleted names and one new one.
