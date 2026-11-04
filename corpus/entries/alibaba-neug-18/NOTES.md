# alibaba/neug#18

Adds continue-on-error: true to the Run Extension Python Test step (which runs the Python extension tests) with a TODO to re-enable after fixing extension loading. Failures of that step no longer fail the job. Stresses W002 on a step level literal true.
