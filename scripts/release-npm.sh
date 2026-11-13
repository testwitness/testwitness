#!/usr/bin/env bash
# Publishes packages/cli to npm with provenance, from .github/workflows/release.yml.
# The first publish of the package is manual (npm cannot attach a trusted publisher to a
# package that does not exist yet), so when the package is not on npm at all this step
# says so and skips. A version already on npm is skipped too. DRY_RUN=1 runs npm publish --dry-run.
set -euo pipefail
cd packages/cli
NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
if [ "${DRY_RUN:-0}" = "1" ]; then
  npm publish --dry-run --access public
  exit 0
fi
if [ "$(npm view "${NAME}@${VERSION}" version 2>/dev/null || true)" = "${VERSION}" ]; then
  echo "${NAME}@${VERSION} is already on npm, skipping"
  exit 0
fi
if ! npm view "${NAME}" name >/dev/null 2>&1; then
  echo "::notice::${NAME} is not on npm yet. The first publish is manual: run npm publish --access public in packages/cli, then add this workflow as the trusted publisher on npmjs.com."
  exit 0
fi
npm publish --provenance --access public
