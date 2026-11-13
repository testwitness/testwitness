# mlflow/mlflow#18210

Applies pytest.mark.xfail to every test in the job tests module through a module level mark list, with a TODO to remove it after fixing flakiness. Fourteen tests can no longer fail. Weakened. Stresses R004 on a module level pytestmark.
