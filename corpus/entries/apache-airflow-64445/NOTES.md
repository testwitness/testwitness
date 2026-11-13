# apache/airflow#64445

Marks fifteen flaky Playwright e2e tests as test.fixme, including one generated in a loop with a template title, and adds xcoms.spec.ts to the Playwright testIgnore list. The xcoms spec is unchanged in the PR; its head version was copied unedited from the git mirror into files/base and files/head (files/tree.json) so the pattern matches a real file. Weakened. Stresses R003 on test.fixme and C001 on testIgnore in one PR.
