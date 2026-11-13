# apache/airflow#63936

Adds a Playwright testIgnore list with four flaky e2e spec files and a TODO pointing at a tracking issue. Those specs stop running in CI. The four spec files are unchanged in the PR; their head versions were copied unedited from the git mirror into files/base and files/head (listed in files/tree.json) so the patterns match real files. Stresses C001 on Playwright testIgnore.
