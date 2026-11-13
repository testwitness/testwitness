# mlflow/mlflow#17630

Adds --ignore=tests/sagemaker to the pytest command of the Windows job, next to existing ignores for suites that cannot run on Windows. The suite still runs in the Linux jobs. Honest scoping, labelled as a control.
