# Fork PRs and security

## What the Action needs

`permissions: contents: read` on `pull_request`. No secrets. The engine makes no network calls (grammars and parsers are bundled) and never executes the repository's code: no install, no test run, no `require` of config files. The Action calls the GitHub REST API with the job token for the optional comment, the acknowledgements and the [run history](./history) artifact (`actions: read`); fork pull requests may run without the history because their read only token may not reach the base repository's artifacts. The history artifact is uploaded only on pushes to the default branch (or with `history_write: true`), never by default from a pull request.

## Mutation on request is the exception

Mutation testing has to run the tests, so testwitness never does it in the check. The optional workflow in [mutation on request](./mutation-on-request) does: you add it yourself, it starts only on a `/testwitness mutate` comment by someone with write permission, and on a pull request from a fork only when the comment names the head commit the maintainer reviewed. The protection is that maintainer gate: nobody's code runs until someone with write permission has asked for it, and on a fork for a commit they reviewed. The job that runs the code also has a read only token, no secrets and no persisted git credentials, and the job that writes the comment runs no code from the pull request and only reads the report with the Action. Leaving caching out of that job does not stop cache poisoning on its own: code that runs in an `issue_comment` workflow runs in the default branch's cache scope and can reach the cache service through the runner's own credentials whatever the setup steps say. Only ask for a mutation run on code you would be willing to run in your default branch's CI.

## Fork PRs

On a `pull_request` event from a fork the token is read only. testwitness still works: findings become annotations on the Files tab, the job summary and `testwitness.json` in the workspace. It cannot post the PR comment; it says so in the log and does not fail. If you want the comment on fork PRs, add a second workflow on `workflow_run` with `pull-requests: write` that downloads the `testwitness.json` artifact, validates it and posts the Markdown. Never use `pull_request_target` for the check itself.

## Report paths and symbolic links

The results, coverage, mutation and history globs do not follow symbolic links by default: a matched file that is a link, or that lies outside the repository through a linked directory, is skipped with a note. A pull request can commit links, so following them would let it point the check at any file on the runner. For Bazel, whose `bazel-testlogs` is a link made by the build, set `paths.followSymlinks: true` in `.testwitness.yml` (read from the base ref, so a pull request cannot turn it on) or pass `--follow-symlinks`:

```yaml
paths:
  followSymlinks: true
results:
  head: "bazel-testlogs/**/test.xml"
```

Results files are read up to 1,000 files and 500 MB, coverage and mutation reports up to 200 files and 50 MB, and a changed runner or coverage config up to 1 MB (a larger one is reported at high without being read).

## PR text is data

The title and body are read from the event payload file, never interpolated into a shell or a workflow command, and escaped before they are quoted in the comment. Escaping also breaks `@mentions` and bare links in text the pull request controls (test names, file names, PR text), so the bot comment never pings anyone or links anywhere on their behalf.

## Configuration from the base ref

A PR cannot relax its own check: `.testwitness.yml` is read from the base ref, and any change to it or to the testwitness workflow step is reported as W006, which only a maintainer can acknowledge.

## Supply chain

Dependencies are pinned by the lockfile; `dist/index.js` is built in CI from the tag; consumers should pin a SHA or a major tag. Report vulnerabilities per SECURITY.md.
