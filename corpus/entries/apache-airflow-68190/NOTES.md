# apache/airflow#68190

Removes leftover import unittest and if __name__ == '__main__': unittest.main() blocks from three Teradata provider test files run by pytest. No test or assertion changes. Honest cleanup.
