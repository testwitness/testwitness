# Releasing

A release is one tag. The release workflow does the rest: it checks, bundles the Action into dist/, commits dist on the tag, moves the major tag (v0), proves the npm package installs on its own, publishes to npm and creates the GitHub release. release-smoke then runs the published Action as a user would.

The release workflow also runs as a dry run on pull requests that change the release path, and by hand from the Actions tab (release, Run workflow). A dry run does every step except the tag push, the attestation, the publish (npm publish --dry-run instead) and the GitHub release.

Two things about npm, as of November 2026: publishing asks for a security key (WebAuthn), so `npm publish` opens the browser and you confirm with the key; and a new version is staged for npm's automated review before anyone can install it, so `npm view` may not list it for a while.

## First release (0.1.0)

Order: nothing is tagged before the security fixes and the v0.1 scope are on main. A pre-release, `0.1.0-rc.0`, went out on 13 November from an earlier main; it is currently the `latest` tag on npm and predates the security fixes, so step 5 retires it.

1. **Main is ready.** The last scope pull request is merged and main is green. Run the dry run: Actions, release, Run workflow on main. Wait for green.
2. **Publish 0.1.0 by hand, once.** npm cannot attach a trusted publisher to a version the workflow has not published before. In a clean checkout of main, with the security key plugged in:

   ```bash
   git checkout main && git pull
   pnpm install --frozen-lockfile && pnpm pack:check
   cd packages/cli && npm publish --access public
   ```

   Confirm in the browser with the key.
3. **Wait for npm's review.** Repeat until it prints 0.1.0:

   ```bash
   npm view testwitness@0.1.0 version
   ```

   Do not tag or announce before this.
4. **Check the dist tags.** Publishing 0.1.0 moves `latest`:

   ```bash
   npm view testwitness dist-tags     # latest: 0.1.0
   ```

5. **Retire the pre-release.** Each command asks for the key again.

   ```bash
   npm deprecate testwitness@0.1.0-rc.0 "Pre-release before the security fixes. Use 0.1.0 or later."
   npm deprecate testwitness@0.0.0-stage "Placeholder. Use 0.1.0 or later."
   npm dist-tag rm testwitness next
   ```

6. **Trusted publishing for later versions.** On npmjs.com: the package, Settings, Trusted publishing, GitHub Actions, organization `testwitness`, repository `testwitness`, workflow `release.yml`. Then under Publishing access choose to require two factor authentication and disallow tokens, so only the workflow (through OIDC) or a maintainer with the key can publish.
7. **Tag.**

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

   The workflow sees 0.1.0 already on npm and skips the publish. It commits dist on the tag, moves v0 and creates the release.
8. **Check the release.** When Actions, release is green:
   - `git ls-remote --tags origin` shows v0.1.0 and v0 on the same commit, "build: dist for v0.1.0".
   - The release page for v0.1.0 exists with generated notes.
   - release-smoke ran after it and is green: the published Action ran on node24 from v0.
9. **Marketplace.** Open the v0.1.0 release, Edit, tick "Publish this Action to the GitHub Marketplace", accept the agreement if asked (it needs two factor authentication on the account), choose the categories Code quality and Testing, Update release.

## Later releases

Bump `version` in packages/cli/package.json, server.json and the plugin manifest in a pull request, merge it, then tag `vX.Y.Z` on main. The workflow refuses a tag that does not match the package version. With trusted publishing set up, the workflow publishes with provenance, and npm still stages the version for review before it can be installed.
