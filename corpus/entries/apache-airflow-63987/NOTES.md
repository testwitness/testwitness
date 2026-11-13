# apache/airflow#63987

Adds two more flaky e2e specs (dag-tasks and variable) to the Playwright testIgnore list. Those specs stop running. The two spec files are unchanged in the PR; their head versions were copied unedited from the git mirror into files/base and files/head (listed in files/tree.json). Stresses C001 on a grown testIgnore list.
