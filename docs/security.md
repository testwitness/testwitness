# Fork PRs and security

## What the Action needs

`permissions: contents: read` on `pull_request`. No secrets. It makes no network calls (grammars and parsers are bundled) and never executes the repository's code: no install, no test run, no `require` of config files.

## Fork PRs

On a `pull_request` event from a fork the token is read only. testwitness still works: findings become annotations on the Files tab, the job summary and `testwitness.json` in the workspace. It cannot post the PR comment; it says so in the log and does not fail. If you want the comment on fork PRs, add a second workflow on `workflow_run` with `pull-requests: write` that downloads the `testwitness.json` artifact, validates it and posts the Markdown. Never use `pull_request_target` for the check itself.

## PR text is data

The title and body are read from the event payload file, never interpolated into a shell or a workflow command, and escaped before they are quoted in the comment.

## Configuration from the base ref

A PR cannot relax its own check: `.testwitness.yml` is read from the base ref, and any change to it or to the testwitness workflow step is reported as W006, which only a maintainer can acknowledge.

## Supply chain

Dependencies are pinned by the lockfile; `dist/index.js` is built in CI from the tag; consumers should pin a SHA or a major tag. Report vulnerabilities per SECURITY.md.
