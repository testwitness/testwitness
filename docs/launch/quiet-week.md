# Quiet week: friendly repositories before Show HN

Goal: testwitness installed on 3 to 5 public repositories for one week, every
false positive report folded into the corpus before its fix merges, before any
public post. Sajjad asks the maintainers; nothing is opened as a PR without a
yes.

## What makes a good candidate

- Java, TypeScript or Python with a steady PR flow (10 or more merged PRs a
  week) so a week produces data.
- Receives agent authored PRs (Copilot, Claude Code, Cursor, Devin), because
  that is the case the tool is for.
- CI already writes JUnit XML, or does so with one flag, so V003 to V006 get
  exercised and not only the diff rules.
- Between 200 and 10,000 stars: big enough to matter, small enough that one
  maintainer can say yes.
- Permissive licence, public workflows, and a maintainer who already answers
  issues within days.

## Candidates, drawn from the corpus (all read only so far)

Known from the corpus: they merge PRs of the shapes the rules look for, and
several already had agent PRs.

| Repository | Language | Stars | Why | Check before asking |
|---|---|---|---|---|
| Hexagon/croner | TypeScript | 2,614 | Small maintainer team, merged Copilot co authored test PRs, Node test runner | Whether CI emits JUnit XML; if not, propose the one flag |
| wevm/ox | TypeScript | 229 | Vitest, fast PR flow, the two inline snapshot loosening PRs came from here | Vitest junit reporter is one line |
| OpenHFT/Chronicle-Queue | Java | 3,827 | Maven Surefire writes XML already, merged generated tests, company maintained | Whether an outside Action is allowed in their workflows |
| TimefoldAI/timefold-solver | Java | 1,846 | Maven, Gradle quickstarts, active community, JUnit 5 | Same |
| microsoft/mssql-jdbc | Java | 1,138 | Maven, two corpus positives (E001, R001), Microsoft open source process allows Actions | Their contribution process may require an internal review |
| pydantic/pydantic-core | Python | 1,766 | pytest, very active, already uses continue-on-error in CI (W002 positive) | Rust plus Python, only the Python tests are in scope |
| sktime/sktime | Python | 10,090 | pytest, community governed, three corpus positives, many first time contributors | Large CI matrix; start with one job's XML |
| tox-dev/tox | Python | 3,979 | pytest, single core maintainer who answers fast | Fine as is |

Pick 3 to 5 across the three languages. My order: croner, Chronicle-Queue or
timefold, pydantic-core, tox, wevm/ox.

## What to ask for

One workflow step on pull_request in report mode (no failing), one week,
feedback by issue on our repository. Report mode posts a comment and never
blocks a merge. The repository owner can remove it with one revert.

## Note to a maintainer (Sajjad sends, adapt per project)

Subject: a one week trial of a test integrity check on <project>

Hi <name>,

I maintain testwitness, a small open source GitHub Action that reads a pull
request's diff and the JUnit XML from the test run and reports whether the PR
weakened its own tests: deleted or skipped tests, assertions loosened, tests
that changed but did not run, and "tests pass" claims the results do not show.
There is no model in it, it makes no network calls and it never runs your
code. It only comments; it does not fail a build in the mode I am proposing.

I am looking for three to five real repositories to run it on for a week
before I talk about it publicly, and <project> is a good fit because <one
honest sentence: steady PR flow, JUnit XML already in CI, agent PRs>.

The ask: one workflow step on pull_request in report mode for one week
(<link to the yaml>), and that you or a contributor tell me about any comment
that is wrong. Every false positive becomes a test case in the repository
before the fix merges. You can revert the step at any time.

If this is not welcome, no reply needed. Thank you either way.

Sajjad

## During the week

- Every reported false positive gets a corpus entry (pr.diff, expected.json
  with verdict fp, NOTES.md) and a golden fixture before the fix merges.
- Count per repository: PRs checked, comments posted, findings by rule and
  severity, false positives reported, time to fix. These numbers go into the
  Show HN first comment as they are.
- No repository or person is named in anything public unless the maintainer
  says so in writing.
