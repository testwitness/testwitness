# Mutation on request

The strongest question about a test is whether it would notice if the code were wrong. Static rules can only guess: O001 sees a new test without an assertion, O002 sees one that only checks that a value exists, and on public pull requests half of those were deliberate smoke tests. Mutation testing measures it. A mutation tool changes the code the pull request changed (a `>` becomes `>=`, a condition becomes `true`, a return value becomes 0) and runs the tests against each change. A change that no test notices is a surviving mutant: the tests would pass on wrong code.

testwitness reads mutation reports; it never produces them. This page is about running a mutation tool on a pull request's changed lines when a maintainer asks for it. The [mutation testing page](./mutation) is about something else: the mutation score of testwitness's own code.

## The promise, and the one exception

The engine and the default Action never execute the scanned repository's code: no install, no test run, no `require` of a config file. That does not change. Mutation testing has to run the tests, so it lives in a separate workflow that you add yourself, that starts only when a maintainer comments `/testwitness mutate` on a pull request, and whose only output testwitness uses is a report file. **That workflow executes the pull request's code.** It is opt in and maintainer triggered for exactly that reason, and it is built so that the job running the code cannot write to the repository, read a secret, or poison a cache, and so that the job which writes the comment never runs the code.

## How it works

1. A maintainer comments `/testwitness mutate` on the pull request (on a pull request from a fork, `/testwitness mutate <head sha>`, see below).
2. The **gate** job reads the comment with `actions/github-script`, asks the REST API for the commenter's permission on the repository (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`) and stops unless it is write or admin. It reads the pull request and records its base and head commits.
3. The **mutate** job checks out that head commit with a read only token, runs `testwitness mutate-plan` to learn which production files and lines changed, runs your test tool with the mutator on just those, and uploads the report as the `testwitness-mutation` artifact.
4. The **report** job checks out the same commit, downloads the artifact and runs the testwitness Action with the `mutation` input. M001 and M002 appear in the same pull request comment as the other findings, and O001 and O002 for new tests are measured instead of guessed.

The template is [docs/workflows/testwitness-mutate.yml](https://github.com/testwitness/testwitness/blob/main/docs/workflows/testwitness-mutate.yml). Copy it to `.github/workflows/`, keep the StrykerJS block or the PIT block, and adjust the install and test commands.

## What testwitness reads

| Tool | Languages | Report | Read |
|---|---|---|---|
| StrykerJS (also Stryker.NET, Stryker4s) | TypeScript, JavaScript | `reports/mutation/mutation.json` from the `json` reporter (the mutation-testing-elements schema) | yes |
| PIT | Java | `target/pit-reports/mutations.xml` with `outputFormats` XML | yes |
| mutmut | Python | `mutants/*.meta`, `mutmut results`, `mutmut export-cicd-stats` | no |

From a Stryker report: every mutant's start line and status (`Killed`, `Timeout`, `Survived`, `NoCoverage`), `killedBy` and `coveredBy`, and `testFiles` to turn test ids into test names. From PIT: every `mutation` element's `sourceFile`, `mutatedClass`, `lineNumber`, `status` (`KILLED`, `TIMED_OUT`, `SURVIVED`, `NO_COVERAGE`) and `killingTest`, or `killingTests` and `succeedingTests` when `fullMutationMatrix` is on. A timed out mutant counts as killed. Compile errors, runtime errors, ignored, pending and non viable mutants are not counted. Test names are normalised to the same keys the JUnit reader builds (a JUnit 5 unique id such as `[class:demo.CartTest]/[method:adds()]` becomes `carttest::adds`), and paths are matched to the repository like coverage paths: relative when the report's project root is inside the checkout, otherwise by suffix, so PIT's `demo/Cart.java` finds `src/main/java/demo/Cart.java`. PIT XML is streamed and its DOCTYPE never resolved; a Stryker report is one JSON document, so it is read whole and parsed, never evaluated. At most 200 report files or 50 MB are read.

**Why not mutmut.** mutmut 3 (3.8.1, checked on 4 Nov 2026) keeps its results in `mutants/<file>.meta`, a JSON map from mutant name (`shop.cart.x_total__mutmut_4`) to the test command's exit code, and `mutmut export-cicd-stats` writes totals only. Neither carries a line number or the test that killed a mutant, and its documentation describes no machine readable format that does; the line of a mutant is only in the diff that `mutmut show` prints for humans. A reader built on that would be built on an undocumented text format, so testwitness reads Stryker and PIT only, `mutate-plan` lists Python files without planning them, and a mutmut file passed to the `mutation` input is skipped with a note in the report.

## What it changes

- **M001 Changed lines with surviving mutants.** For each changed production file, the added or modified lines on which no mutant was killed. Medium when at least 3 such lines or more than half of the mutated changed lines; low otherwise. Label measured weak.
- **M002 New test kills nothing.** A test added in the pull request that killed no mutant anywhere in the reports. High when it exercises a changed production file with mutants on its changed lines; medium otherwise. Only when the reports name killing tests; otherwise the report carries a note and M002 is silent.
- **O001 and O002 are measured.** For a new test without an assertion (O001) or with a smoke oracle only (O002): when the changed lines it exercises carry mutants and none was killed, the finding is medium with the label measured weak; when the test itself killed a mutant on those lines, the finding is dropped. Without mutation data both stay low, as before.

Which production files a test exercises comes from the report when it records coverage per test (Stryker `coveredBy` with `coverageAnalysis: perTest`, PIT `succeedingTests` with `fullMutationMatrix`), and otherwise from the test file's name and imports, as the other rules map tests to code. The rules reference has the false positive controls for each rule.

## `testwitness mutate-plan`

Prints the changed production files and the settings that mutate only them. It reads git and nothing else.

```
testwitness mutate-plan --base origin/main --head HEAD --format json
testwitness mutate-plan --base "$BASE" --head "$HEAD" --format shell --out plan.env
```

- StrykerJS: `--mutate` with one entry per changed line range (`src/cart.ts:12-18`), plus `--incremental`, `--coverageAnalysis perTest` and the json reporter.
- PIT: `targetClasses` from the package declaration of each changed class (and its inner classes), `targetTests` from the test classes named after it (`CartTest`, `CartTests`, `TestCart`, `CartIT`), or its package when there is none; `outputFormats` XML, `timestampedReports` false and `fullMutationMatrix` true, so M002 sees every killing test.

The shell format is a list of single quoted assignments (`STRYKER_MUTATE`, `PIT_TARGET_CLASSES`, `PIT_TARGET_TESTS`, the report paths, the base and head) that the workflow sources. File names come from the pull request, so a path with any character outside letters, digits and `_ . / @ + -` is left out of the plan with a note rather than quoted.

## Pull requests from forks

An `issue_comment` workflow runs the workflow file of the default branch with the base repository's token and secrets, whoever wrote the pull request. GitHub's setting that holds fork workflows for approval does not apply to it. So the template treats fork pull requests as untrusted code that a maintainer has to approve commit by commit:

- The comment must name the head commit the maintainer reviewed, at least 12 hex digits: `/testwitness mutate 1a2b3c4d5e6f`. A shorter prefix can be matched by a commit ground out and pushed after the review. A bare `/testwitness mutate` on a fork pull request is refused with the sha to use.
- If the head moved after the comment, the gate refuses and asks for a new comment, and the mutate job checks out exactly the gated commit, so a push between the comment and the checkout is never run.
- The mutate job has `contents: read` and nothing else, no secrets, `persist-credentials: false`, and no `cache:` on any setup step: a cache saved by an `issue_comment` run is scoped to the default branch, so code from the pull request could otherwise plant it for later trusted runs.
- The report job never runs a step of its own, uses the published Action (never `uses: ./`), and treats the artifact as untrusted data: the readers only parse it, within the caps.

What remains is what any test run of untrusted code allows: it uses runner minutes and has outbound network access from the runner. Review the diff before you name its sha.

## Run times

Measured here: StrykerJS 10.1.1 with the Vitest runner on the golden fixture projects (one changed file, 5 to 18 mutants) took 4 to 8 seconds per run on two cores, most of it start up. Our own full run over `packages/core/src` (about 5,100 mutants) takes about 20 minutes on two cores, roughly a quarter of a second per mutant.

Estimated, not measured: a pull request that changes 50 to 200 production lines gives on the order of 50 to 400 mutants, so the mutation step itself takes 1 to 5 minutes with StrykerJS, on top of the install and one normal test run. PIT adds Maven start up and compilation, and `fullMutationMatrix` runs every covering test against every mutant instead of stopping at the first kill, which can multiply the time by the number of tests per class; drop it from the command if the run is too slow, at the cost of M002 missing a test whose kills an earlier test also made. The template's job timeout is 60 minutes.

## Inputs

The Action's `mutation` input, the CLI's `--mutation` and `mutation.paths` in `.testwitness.yml` take comma separated globs of report files. The report gains a `mutation` section (sources, files, mutants, killed, survived, noCoverage, notes) and the comment a Mutation line under Evidence. Without mutation reports nothing changes.
