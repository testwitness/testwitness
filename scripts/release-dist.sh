#!/usr/bin/env bash
# Commits the bundled Action (dist/) on the release tag and moves the major tag (v0) to it.
# Run by .github/workflows/release.yml after `pnpm bundle:action`. With DRY_RUN=1 it does every
# step except the push and then proves the tag holds what the Marketplace and users need.
#   scripts/release-dist.sh v0.1.0
set -euo pipefail
TAG="${1:?usage: release-dist.sh <tag>}"
if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "::error::tag $TAG is not vMAJOR.MINOR.PATCH"; exit 1; fi
VERSION="$(node -p "require('./packages/cli/package.json').version")"
if [ "v$VERSION" != "$TAG" ]; then echo "::error::tag $TAG does not match packages/cli/package.json version $VERSION"; exit 1; fi
for f in server.json packages/cli/plugin/.claude-plugin/plugin.json; do
  v="$(node -p "require('./$f').version")"
  [ "$v" = "$VERSION" ] || { echo "::error::$f has version $v, packages/cli/package.json has $VERSION"; exit 1; }
done
SV="$(node -p "require('./server.json').packages[0].version")"
[ "$SV" = "$VERSION" ] || { echo "::error::server.json packages[0].version is $SV, expected $VERSION"; exit 1; }
grep -Eq '^\s+using:\s+node24\s*$' action.yml || { echo "::error::action.yml must declare runs.using node24"; exit 1; }
[ -s dist/index.js ] || { echo "::error::dist/index.js is missing; run pnpm bundle:action first"; exit 1; }
MAJOR="${TAG%%.*}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -f dist
git commit -q -m "build: dist for ${TAG}" || true
git tag -f "$TAG" >/dev/null
git tag -f "$MAJOR" >/dev/null

# What a user of `uses: testwitness/testwitness@v0` gets: action.yml on node24 and the bundle it names.
for ref in "$TAG" "$MAJOR"; do
  git show "$ref:action.yml" | grep -Eq '^\s+using:\s+node24\s*$' || { echo "::error::$ref: action.yml is not node24"; exit 1; }
  git cat-file -e "$ref:dist/index.js" || { echo "::error::$ref: dist/index.js is not committed"; exit 1; }
done
echo "$TAG and $MAJOR point at $(git rev-parse --short "$TAG^{commit}") with dist/index.js ($(git cat-file -s "$TAG:dist/index.js") bytes) and action.yml on node24"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "dry run: not pushing $TAG and $MAJOR"
else
  git push -f origin "refs/tags/$TAG" "refs/tags/$MAJOR"
fi
