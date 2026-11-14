# Fork PRs and security

## What the Action needs

`permissions: contents: read` on `pull_request`. No secrets. The engine makes no network calls (grammars and parsers are bundled) and never executes the repository's code: no install, no test run, no `require` of config files. The Action calls the GitHub REST API with the job token for the optional comment and the acknowledgements, and for nothing else.

## Fork PRs

On a `pull_request` event from a fork the token is read only. testwitness still works: findings become annotations on the Files tab, the job summary and `testwitness.json` in the workspace. It cannot post the PR comment; it says so in the log and does not fail. If you want the comment on fork PRs, add a second workflow on `workflow_run` with `pull-requests: write` that downloads the `testwitness.json` artifact, validates it and posts the Markdown. Never use `pull_request_target` for the check itself.

## Report paths and symbolic links

The report and the Markdown file are never written through a symbolic link at the output path. The results globs do not follow symbolic links by default: a matched file that is a link, or that lies outside the repository through a linked directory, is skipped with a note. A pull request can commit links, so following them would let it point the check at any file on the runner. For Bazel, whose `bazel-testlogs` is a link made by the build, set `paths.followSymlinks: true` in `.testwitness.yml` (read from the base ref, so a pull request cannot turn it on) or pass `--follow-symlinks`:

```yaml
paths:
  followSymlinks: true
results:
  head: "bazel-testlogs/**/test.xml"
```

Results files are read up to 1,000 files and 500 MB, and a changed runner or coverage config up to 1 MB (a larger one is reported at high without being read).

## PR text is data

The title and body are read from the event payload file, never interpolated into a shell or a workflow command, never written into the checkout, and escaped before they are quoted in the comment. Escaping also breaks `@mentions`, issue references and bare links in text the pull request controls (test names, file names, PR text), so the bot comment never pings anyone or links anywhere on their behalf. Control characters, bidirectional overrides and invisible characters are replaced in every output, and no text from the pull request can start a workflow command in the step log. The [threat model](./threat-model) has the details for each output.

## Configuration from the base ref

A PR cannot relax its own check: `.testwitness.yml` is read from the merge base, and a config the pull request adds or changes is never read, also when the base branch has none. The `config` input of the Action is read at the merge base too when it names a file in the repository. Any change to the config or to the testwitness workflow step is reported as W006, which only someone with write access can acknowledge, by a comment. On `pull_request` events the workflow file itself comes from the pull request, so make the check required in the branch protection; see the [threat model](./threat-model).

## The agent hook

`testwitness hook` runs on a developer machine, possibly in a repository the user has just cloned and does not trust. It keeps the same promises as the check:

* It reads `.testwitness.yml` from the merge base only, never from the working tree, so the change being judged cannot relax its own judge. Changes to that file and to the hook config files are W006 findings.
* It makes no network call. The hook tests run with socket connect, DNS, UDP and fetch replaced by functions that throw, and pass in a network namespace without interfaces (`unshare -rn`).
* The only program it starts is `git`, with local subcommands (`rev-parse`, `merge-base`, `symbolic-ref`, `diff`, `show`, `ls-tree`, `log`, `add`, `read-tree`, `write-tree`). A test traces every child process on a repository full of traps (package scripts, test runner configs, git hooks, an fsmonitor program, an external diff, a textconv) and asserts that none ran.
* The working tree is read through a snapshot in a temporary index and a temporary object directory under the OS temp dir. The repository's index, refs and object store are not written. For the snapshot, git hooks and fsmonitor are switched off; `git diff` runs with `--no-ext-diff --no-textconv`. One thing does run: a clean filter you configured in git (Git LFS, git-crypt), as it does for `git add`. A repository's files can select a filter but cannot define one.
* The loop guard's counts are in a per user directory under the OS temp dir (mode 0700, ownership checked, not used when anyone else can write to it), never in the repository.
* It fails open: a crash, the timeout and the loop guard all allow the action and say so. It is an early warning, not a sandbox; the [threat model](./threat-model#the-hook) lists what it does not stop.
* `testwitness init` writes one config file and never runs anything from the repository. The hook command it writes never downloads a package (`npx --no-install` at most).

## The PR trial

`testwitness check --pr <url>` is the one path that uses the network, and the only code that does lives in the CLI package (`packages/cli/src/pr.ts`). It runs before the engine and only when `--pr` is given. Every other path keeps the promise above; a test runs the plain `check` under the network guard and the process trace and asserts that no socket, DNS lookup, fetch or remote git command happened.

What it fetches:

* With git, from `https://github.com/<owner>/<repo>.git`: the pull request head (`refs/pull/<n>/head`) and the base branch. Outside a clone of that repository it first makes a blobless clone of the default branch, so commits and trees come down but file contents do not. Before the engine runs, it fetches by object id only the files the engine reads: the changed files at both sides, the other files in their directories and files of the same name (for move and refactor detection), the files at the root and the agent hook configs.
* At most one unauthenticated `GET https://api.github.com/repos/<owner>/<repo>/pulls/<n>`, for the title, body, base branch and head commit. Redirects are not followed. If it fails, nothing else is tried.

Why it stays safe:

* The URL is untrusted input. Only `https://github.com/<owner>/<repo>/pull/<number>` is accepted, with an optional trailing path such as `/files`. Owner and repository must match GitHub's own name rules, the input must be printable ASCII and at most 512 characters, and encoded characters, `..`, other hosts, user info, ports and ssh URLs are refused before any git or network call. The URLs testwitness fetches are rebuilt from the parsed parts, never copied from the input.
* No token is read, asked for or stored, and `gh` is not used. Every git call runs with credential helpers off, configured extra HTTP headers (where a CI checkout keeps its token) cleared, `GIT_TERMINAL_PROMPT=0`, and only the `https` transport allowed.
* Nothing from the fetched repository runs. Nothing is checked out; files are read as blobs (`git cat-file --batch`), and the diff runs with `--no-ext-diff --no-textconv`. Every git call sets `core.hooksPath=/dev/null` and `core.fsmonitor=false`, clears the LFS filter (`filter.lfs.smudge=`, `filter.lfs.process=`, `filter.lfs.required=false`), and does not fetch submodules. A test fetches a repository whose `.gitattributes` selects a filter and a diff driver and asserts that git started nothing but its own transport (`upload-pack`, `pack-objects`, `index-pack`).
* The engine stays offline. It runs on a read only view: a new, empty bare repository in the temp directory that borrows the fetched objects through `objects/info/alternates`. The view has no remote, so git cannot fetch a missing file from inside the engine; a file that was not fetched up front reads as absent. The view is deleted after the run.
* The cached clone lives in a per user directory under the temp directory (mode 0700, ownership checked, never a link). A clone is made in a temporary directory and renamed into place when complete, so an interrupted clone is never reused. A cached clone whose `origin` is not the expected URL is refused, not reused.
* The title and body are data, as in the Action: they feed the claim rules and are escaped in the output.

## Supply chain

Dependencies are pinned by the lockfile; `dist/index.js` is built in CI from the tag; consumers should pin a SHA or a major tag. Report vulnerabilities per SECURITY.md.

## The full picture

The [threat model](./threat-model) goes through every entry point and output, names the test behind each claim, and lists what the security review of November 2026 found, what it fixed and what is still open.
