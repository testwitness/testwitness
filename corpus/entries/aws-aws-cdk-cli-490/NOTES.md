# aws/aws-cdk-cli#490

Adds a workflow step to the codecov job that rewrites every jest.config.json at run time to reset coverage thresholds, so the coverage run cannot fail on them. Weakened gate in that job, done by a run step the engine does not interpret (missed). Stresses C002 on thresholds removed at CI run time.
