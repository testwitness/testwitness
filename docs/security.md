# Fork PRs and security

## What the Action needs

`permissions: contents: read` on `pull_request`. No secrets. The engine makes no network calls (grammars and parsers are bundled) and never executes the repository's code: no install, no test run, no `require` of config files. The Action calls the GitHub REST API with the job token for the optional comment, the acknowledgements and the [run history](./history) artifact (`actions: read`); fork pull requests may run without the history because their read only token may not reach the base repository's artifacts. The history artifact is uploaded only on pushes to the default branch (or with `history_write: true`), never by default from a pull request.

## Mutation on request is the exception

Mutation testing has to run the tests, so testwitness never does it in the check. The optional workflow in [mutation on request](./mutation-on-request) does: you add it yourself, it starts only on a `/testwitness mutate` comment by someone with write permission, and on a pull request from a fork only when the comment names the head commit the maintainer reviewed. The job that runs the code has a read only token, no secrets, no persisted git credentials and no cache; the job that writes the comment runs no code from the pull request and only reads the report with the Action.

## Fork PRs

On a `pull_request` event from a fork the token is read only. testwitness still works: findings become annotations on the Files tab, the job summary and `testwitness.json` in the workspace. It cannot post the PR comment; it says so in the log and does not fail. If you want the comment on fork PRs, add a second workflow on `workflow_run` with `pull-requests: write` that downloads the `testwitness.json` artifact, validates it and posts the Markdown. Never use `pull_request_target` for the check itself.

## PR text is data

The title and body are read from the event payload file, never interpolated into a shell or a workflow command, and escaped before they are quoted in the comment.

## Configuration from the base ref

A PR cannot relax its own check: `.testwitness.yml` is read from the base ref, and any change to it or to the testwitness workflow step is reported as W006, which only a maintainer can acknowledge.

## Supply chain

Dependencies are pinned by the lockfile; `dist/index.js` is built in CI from the tag; consumers should pin a SHA or a major tag. Report vulnerabilities per SECURITY.md.
