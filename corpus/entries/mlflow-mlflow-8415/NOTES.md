# mlflow/mlflow#8415

Removes a bare assert comparing recorded part upload calls to the expected list because it was flaky. Weakened. Stresses A001 on a pytest bare assert.
