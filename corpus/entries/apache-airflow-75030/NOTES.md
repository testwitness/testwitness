# apache/airflow#75030

Doubles the result count and shrinks each result payload in a LocalExecutor stress test so the pipe drain order matches production. The assertions are unchanged. Honest flaky fix.
