# Show HN draft (do not post until the precision table has true positives for the main rules)

Title: Show HN: Testwitness, a PR check that says whether the tests still test anything (Java, TS, Python)

Text (Show HN posts usually have no text when there is a link; this is the first comment from the author):

I spent six and a half years in test automation before moving to backend work, and the thing that bothered me most about agent written PRs was not the code. It was that CI stayed green while the tests quietly stopped meaning anything: a skip here, an assertEquals turned into assertNotNull there, a try/catch around the call that used to fail, and a PR description that said "all tests pass" when nothing had run.

testwitness is a GitHub Action and CLI that reads the diff, the test source (tree-sitter) and the JUnit XML, and puts the answer on the PR. It reports three states, pass, review or unreadable, and it never says a PR lied, because in the one audit I know of most unverifiable "tests pass" claims were unreadable output, not lies.

What it is not: there is no model in it. Every finding is a deterministic rule with a before and after you can read. It does not run your code and makes no network calls.

Honest numbers: [precision table summary goes here, per rule, with the false positive count on the held out half of the corpus]. The corpus of real public PRs it was measured on is in the repo, and every false positive report becomes a corpus entry before the fix merges.

Things it gets wrong today: assertion helpers that do not follow a naming convention and live in another module need a line of config; moved tests that were also rewritten are reported low rather than silent; it knows nothing about mutation score yet (planned, by wrapping Stryker, PIT and mutmut).

Works on human PRs too. Java support is there because that is where I have seen the most of this.
