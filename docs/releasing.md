# Releasing

A release is one tag. The release workflow does the rest: it checks, bundles the Action into dist/, commits dist on the tag, moves the major tag (v0), proves the npm package installs on its own, publishes to npm and creates the GitHub release. release-smoke then runs the published Action as a user would.

The release workflow also runs as a dry run on pull requests that change the release path, and by hand from the Actions tab (release, Run workflow). A dry run does every step except the tag push, the attestation, the publish (npm publish --dry-run instead) and the GitHub release.

## First release (0.1.0), about ten minutes

1. Main is green and the dry run passes: Actions, release, Run workflow on main. Wait for green.
2. npm, once only. In a clean checkout of main:

   ```bash
   pnpm install --frozen-lockfile && pnpm pack:check
   cd packages/cli && npm publish --access public
   ```

   Then on npmjs.com open the package, Settings, Trusted publishing, add GitHub Actions with organization `testwitness`, repository `testwitness`, workflow `release.yml`. Later versions publish from the workflow with provenance.

   If npm is not available yet, skip this step. The tag still releases the Action, and the publish step says the package is not on npm yet and skips. Publish by hand later with the same commands.
3. Tag:

   ```bash
   git checkout main && git pull
   git tag v0.1.0 && git push origin v0.1.0
   ```

4. Watch Actions, release. When it is green:
   - `git ls-remote --tags origin` shows v0.1.0 and v0 on the same commit, "build: dist for v0.1.0".
   - The release page for v0.1.0 exists with generated notes.
   - release-smoke ran after it and is green: the published Action ran on node24 from v0.
5. Marketplace: open the v0.1.0 release, Edit, tick "Publish this Action to the GitHub Marketplace", accept the agreement if asked (it needs two factor authentication on the account), choose the categories Testing and Code quality, Update release.

## Later releases

Bump `version` in packages/cli/package.json in a pull request, merge it, then tag `vX.Y.Z` on main. The workflow refuses a tag that does not match the package version.
