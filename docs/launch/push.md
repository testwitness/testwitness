# First public push (Sajjad runs every command)

Order matters. Each block is paste ready for a terminal on the Mac. Replace
anything in angle brackets. Nothing here needs a token in a file: `gh` and
`npm` keep their own logins in the keychain.

## 0. Before you start

- `pnpm check` green on the bundle you are about to push (the counts are in LOG.md).
- The README lists only rules with measured true positives.
- You are logged in: `gh auth status` and `npm whoami` both answer.
- npm account has 2FA on (required for the first publish and for `npm trust`).
- Node 22 or newer and npm 11.10 or newer on the Mac: `node -v`, `npm -v`
  (`npm install -g npm@latest` if older).

## 1. Clone the bundle, rewrite the commit authors

```sh
rm -rf ~/testwitness
git clone ~/Project\ AI\ Builder/testwitness/testwitness.bundle ~/testwitness
cd ~/testwitness
git config user.name "Sajjad Hossain"
git config user.email "<id>+<user>@users.noreply.github.com"
scripts/rewrite-authors.sh "Sajjad Hossain" "<id>+<user>@users.noreply.github.com"
git log --format='%an <%ae>' | sort -u
```

The last line must print exactly one author line, yours.

## 2. Create the repository and push

```sh
gh repo create testwitness/testwitness --public \
  --description "Did this PR weaken its tests, and did they actually run? Java, TypeScript, Python." \
  --homepage "https://testwitness.github.io/testwitness/" \
  --disable-wiki
git remote add origin https://github.com/testwitness/testwitness.git
git push -u origin main
gh repo edit testwitness/testwitness --enable-issues --enable-projects=false \
  --add-topic github-action --add-topic testing --add-topic code-review \
  --add-topic junit --add-topic pytest --add-topic jest --add-topic tree-sitter
```

Watch the first `ci` run finish: `gh run watch --repo testwitness/testwitness`.

## 3. Branch protection and fork workflow approval

```sh
gh api -X PUT repos/testwitness/testwitness/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["check"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
gh api -X PUT repos/testwitness/testwitness/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
gh api -X PUT repos/testwitness/testwitness/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

`check` is the job name in `.github/workflows/ci.yml`. Reviews are not
required because you are the only maintainer; turn them on when a second
maintainer joins.

## 4. GitHub Pages for the docs site

```sh
gh api -X POST repos/testwitness/testwitness/pages -f build_type=workflow
gh workflow run docs.yml --repo testwitness/testwitness
```

## 5. Reserve the npm name with the first publish (manual, once)

npm cannot configure a trusted publisher for a package that does not exist,
so version 0.1.0 is published from your terminal. Everything after that is
the release workflow.

```sh
cd ~/testwitness
pnpm install --frozen-lockfile
pnpm check
pnpm pack:check
cd packages/cli
npm publish --provenance=false --access public
```

Then hand publishing to the workflow:

```sh
npm trust github testwitness \
  --repository testwitness/testwitness --workflow release.yml
npm access set mfa=automation testwitness
```

(`--provenance=false` on the manual publish because provenance from a laptop
is not meaningful; the workflow publishes with provenance from then on.)

## 6. Tag the release

```sh
cd ~/testwitness
git tag -a v0.1.0 -m "testwitness v0.1.0"
git push origin v0.1.0
gh run watch --repo testwitness/testwitness
```

The release workflow runs `pnpm check`, builds the Action bundle, commits
`dist/` on the tag, moves the `v0` tag, attests the bundle, and publishes to
npm unless that version is already on the registry (0.1.0 is, from step 5,
so the step is skipped; from v0.1.1 on it publishes with provenance). Then it
creates the GitHub release with generated notes.

## 7. Marketplace listing

Marketplace publishing is a web form, not an API. Open
https://github.com/testwitness/testwitness/releases, pick v0.1.0, tick
"Publish this Action to the GitHub Marketplace", and paste the text from
`docs/launch/marketplace.md`. Requirements already met in the repo: a single
`action.yml` at the root with `branding`, a README, and 2FA on the account.

## 8. After the push

- Open one small PR yourself (a typo fix) to see the dogfood comment appear.
- Send me the repository URL. I clone from it and the rewritten history
  becomes the only history.
