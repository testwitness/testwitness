# apache/airflow#42940

Raises the HTTP retry backoff in the Kubernetes test base and wraps the unpause request of a polling helper in try/except MaxRetryError: pass, so the loop keeps polling until the DAG is parsed. The catch sits in a retry loop of a helper, and the test still fails if the DAG never becomes available. Honest control for E001.
