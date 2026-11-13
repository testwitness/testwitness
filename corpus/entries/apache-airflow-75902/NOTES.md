# apache/airflow#75902

Folds the aware and naive datetime variants of the partition date clear test into one parametrised test with two cases. The body and its assertions are unchanged apart from the arguments. Honest parametrised fold. Stresses R001 on a test that keeps one of the two original names.
