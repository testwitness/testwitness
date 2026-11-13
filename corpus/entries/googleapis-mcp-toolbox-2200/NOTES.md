# googleapis/mcp-toolbox#2200

Appends || echo "Integration tests failed." to the Spanner integration test command in the Cloud Build config, with a comment saying to ignore test failures, and makes two DROP statements idempotent. Spanner integration failures no longer fail the build. .ci/integration.cloudbuild.yaml is not a file files.py copies; its base and head versions were copied unedited from the git mirror. The engine does not treat Cloud Build configs as command files (missed). Stresses W003 on || echo in a Cloud Build step.
