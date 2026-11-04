# Community launch drafts (drafts only, the maintainer posts everything himself)

Prepared 4 Nov 2026. Nothing here has been posted. Rules were fetched live on 4 Nov 2026 where the site allowed it. Where a site blocked the fetch, the heading says so and no rule is assumed.

Before anything goes out:

- The repo must be public and installable, and the clearance gate in LOG.md must be cleared. The repo URL below is written as [repo URL] everywhere (the planned home is github.com/testwitness/testwitness, not yet confirmed live).
- Every number in the drafts is copied from README.md or docs/precision.md as they stood on 4 Nov 2026 (101 public pull requests). Regenerate with `pnpm corpus:report` and re check each number against the drafts on launch day.
- If an AI tool helped write any of this, dev.to's Code of Conduct asks for disclosure. Edit every draft in your own words before posting; they are starting points.

## Summary

Allowed with conditions: Hacker News, dev.to (as a real article), Hashnode (as a real article), pytest Discussions (Show and tell), Jest Discussions (Show and tell), Vitest Discussions (Show and tell), Changelog News, awesome-actions (by pull request).

Do not post here: JUnit Discussions (no fitting category, no sign tool announcements are welcome).

Rules could not be read, so posting is undecided until he reads them himself: Lobsters, r/programming, r/java, r/typescript, r/Python, r/devops, r/githubactions, r/ExperiencedDevs, r/softwaretesting, r/QualityAssurance. Also not read: dev.to publishing guidelines page, Hashnode content policy page, the Jest and Vitest Discord servers, and any JUnit mailing list.

Shared facts used in the drafts (all from README.md or docs/precision.md):

- R003 (test newly skipped or disabled): 20 true positives, 0 false positives, precision 1.00.
- R001 (test function deleted): 15 true positives, 9 false positives, precision 0.63.
- A001 (assertion removed): 5 true positives, 19 false positives, precision 0.21.
- O001 (new test without an assertion): 0 true positives, 5 false positives, precision 0.00.
- Corpus: 101 public pull requests.

---

## Hacker News

Rule read on 4 Nov 2026 at https://news.ycombinator.com/showhn.html

Rules in short: a Show HN must be something you made that others can try, it must be non trivial, and you must be around to discuss it. Blog posts, landing pages, sign up pages and plain version updates do not qualify. Asking friends to upvote or comment is not ok. The page has no open source requirement and no account age rule.

Allowed? Yes. An open source tool posted by its author fits Show HN as long as it can be run today without a sign up, and the title begins with "Show HN".

Existing draft (docs/launch/show-hn.md) checked against the rules:

- The page names no title length limit, but the current title is 99 characters. I believe HN cuts titles at 80 characters; that is from memory, not from the page I read, so test it in the submit form. A shorter option at 71 characters: "Show HN: Testwitness, a PR check for weakened tests (Java, TS, Python)".
- The "Honest numbers" paragraph is still a placeholder. It can be filled now from precision.md: held out half, R003 13 true positives and 0 false positives, R001 12 true positives and 6 false positives, A001 3 true positives and 2 false positives, O001 0 true positives and 3 false positives. Add the full corpus numbers if you prefer.
- "Things it gets wrong today" does not mention the weakest rules. A001 (precision 0.21 on all 101 PRs) and O001 (5 false positives, 0 true positives, all rated high severity) are the honest gaps and a reader will find them in precision.md within a minute. Say so first.
- It does not give a one line way to try it. The page says easy to try brings more feedback, so add the `npx testwitness check` line from the README.
- The draft says the title and text are separate, but Show HN with a link normally has no text. The first comment is the right place for it. Nothing else in the draft breaks a rule. It contains no dashes and no claims of users.

Do not post until the repo is public. Do not ask anyone to upvote.

---

## Lobsters

Rule NOT read. The fetch of https://lobste.rs/about on 4 Nov 2026 failed because the site's robots file disallows the fetch tool. No rule is assumed here.

Allowed? Unknown. The only fact I have is yours: the site is invitation only.

If he has no account: an invite has to come from an existing member. Ask someone you know there directly. Do not ask strangers in public. Once he has an account, read https://lobste.rs/about himself before submitting, in particular what it says about posting your own work, how often, and which tags apply. I did not verify any of that.

Draft, held until the rules are read and an account exists:

Title: testwitness: a pull request check that reports weakened tests

URL: [repo URL]

Author comment:

I wrote this after six and a half years in test automation. It reads a PR diff, the test source with tree-sitter and the JUnit XML from the run, and says whether the tests still prove anything. There is no model in it, it makes no network calls and it never runs the code it scans. Every finding is a deterministic rule with a before and after.

It is wrong in places today. On 101 public pull requests the assertion removed rule has precision 0.21, and the new test without an assertion rule had 5 false positives and no true positives. Those numbers are in docs/precision.md. I would like to hear where else it misreads a diff.

---

## reddit (shared draft, used by the nine subreddits below)

Reddit rules could not be read. Every fetch of reddit.com returned "Access to this website has been blocked" on 4 Nov 2026 (tried r/programming, r/java, r/Python, r/devops, r/ExperiencedDevs; the same site level block applies to the others, which I did not try separately). I did not try a way around the block and I am not guessing rules from memory.

So for each subreddit the status is: allowed or not is unknown. Before posting anywhere, read the sidebar and the rules page for these points: is a post about your own project allowed at all, is there a required flair, is there a weekday or self promotion thread, is there a ratio or history requirement for the account, is there a minimum account age or karma, and is there a rule about AI written text.

Shared post body (about 220 words, edit the opener per subreddit):

> I spent six and a half years in test automation, mostly Java. What bothers me about agent written pull requests is not the code. CI stays green while the tests quietly stop meaning anything: a skip here, an assertEquals turned into assertNotNull there, a try/catch around the call that used to fail.
>
> So I built testwitness, an open source GitHub Action and CLI. It reads the PR diff, the test source (tree-sitter) and the JUnit XML from the run, and comments on the PR with one of three states: pass, review or unreadable. It never says a PR lied.
>
> There is no model in it. Every finding is a deterministic rule with a before and after you can read. It makes no network calls and never runs your code. Java, TypeScript and JavaScript, and Python.
>
> What it gets wrong today: on a corpus of 101 public pull requests, the assertion removed rule has precision 0.21 (19 false positives), and the new test without an assertion rule had 5 false positives and no true positives. The skipped test rule found 20 true positives and 0 false positives. Per rule numbers are in docs/precision.md.
>
> Repo: [repo URL]
>
> I would like to hear which false positives you hit on your own PRs. Each report becomes a corpus entry before the fix merges.

### r/programming

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/programming/about/rules was blocked by the site.

Allowed? Unknown, read the sidebar first.

Title (67 characters): I built a PR check that flags tests that were weakened or never ran

Body: shared draft above.

### r/java

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/java/about/rules was blocked by the site.

Allowed? Unknown, read the sidebar first.

Title (92 characters): A GitHub Action that tells you when a PR weakens JUnit or TestNG tests, no model, no network

Body: shared draft, but start with one more sentence: "It handles JUnit 4 and 5, TestNG, AssertJ and Mockito, and reads Surefire and Gradle XML as they come."

### r/typescript

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/typescript/about/rules was not attempted separately because reddit.com is blocked site wide for this tool.

Allowed? Unknown, read the sidebar first.

Title (76 characters): PR check for TypeScript tests: catches skipped, loosened and never run tests

Body: shared draft, with one more sentence: "Jest, Vitest, Mocha and Playwright Test are covered. Jest needs jest-junit and Vitest needs `--reporter=junit` to give it results."

### r/Python

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/Python/about/rules was blocked by the site.

Allowed? Unknown, read the sidebar first.

Title (69 characters): testwitness: a PR check that flags weakened pytest and unittest tests

Body: shared draft, with one more sentence: "For pytest you pass `--junitxml` so it can see what actually ran."

### r/devops

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/devops/about/rules was blocked by the site.

Allowed? Unknown, read the sidebar first.

Title (81 characters): A CI check for the case where the pipeline is green but the tests stopped testing

Body: shared draft, with this opener swapped in: "A green pipeline only says the tests that ran passed. It says nothing about tests that were skipped, deleted or never collected. I wanted a check for that." It also catches `continue-on-error` added to a test step and failures suppressed in the run command (W002 and W003, both 1.00 precision on the corpus, with 4 and 1 true positives).

### r/githubactions

Rule NOT read on 4 Nov 2026, fetch not attempted separately because reddit.com is blocked site wide for this tool.

Allowed? Unknown, read the sidebar first.

Title (74 characters): testwitness: a GitHub Action that comments when a PR weakens its own tests

Body: shared draft, with one more sentence: "It runs on pull_request with `contents: read`, needs no secrets, and the install is one YAML block in the README."

### r/ExperiencedDevs

Rule NOT read on 4 Nov 2026, fetch of https://www.reddit.com/r/ExperiencedDevs/about/rules was blocked by the site.

Allowed? Unknown. Many experience focused subreddits limit project posts, but I cannot confirm this one, so treat it as possibly not allowed until read. A discussion style post may be the only form that fits, with the tool link left out or in a comment.

Title (87 characters): How do you review whether an agent PR still tests anything, not just whether CI passes?

Body (discussion form, 120 words):

> After six and a half years in test automation I keep seeing the same thing in agent written PRs. CI stays green, but a test was skipped, an assertion went from equals to not null, or a try/catch now swallows the failure. The PR description still says all tests pass.
>
> How do you catch this in review today? Reading every test diff does not scale, and coverage numbers do not notice any of it.
>
> I ended up writing a small open source check for it, deterministic rules over the diff and the JUnit XML, no model. It gets plenty wrong (the assertion removed rule has precision 0.21 on the 101 pull requests I measured). I am more interested in what reviewers actually look at than in promoting it. Link in a comment if the rules allow it.

### r/softwaretesting

Rule NOT read on 4 Nov 2026, fetch not attempted separately because reddit.com is blocked site wide for this tool.

Allowed? Unknown, read the sidebar first.

Title (69 characters): A PR check that tells reviewers when tests were weakened or never ran

Body: shared draft, with this opener: "Test automation was my job for six and a half years, so this one is personal."

### r/QualityAssurance

Rule NOT read on 4 Nov 2026, fetch not attempted separately because reddit.com is blocked site wide for this tool.

Allowed? Unknown, read the sidebar first.

Title (81 characters): Open source PR check for QA: flags deleted, skipped and never run tests on the PR

Body: shared draft, with one more sentence: "It reports review, not blame. The reviewer decides, and any finding can be acknowledged with a reason that stays in the report."

---

## dev.to

Rule read on 4 Nov 2026 at https://dev.to/terms and https://dev.to/code-of-conduct (the https://dev.to/guidelines page failed to fetch, so the publishing guidelines were not read)

Rules in short: Terms section 11 asks for content that is "not designed primarily for the purposes of promotion or creating backlinks", with substantial content in the post and not just a link out. The Code of Conduct asks you to disclose AI assistance if used and to cite sources. Neither page sets a limit on posting about your own open source project, an account age or a posting ratio.

Allowed? Yes, as a real article that teaches something and mentions the project, not as an announcement that is only a link. Tag suggestions: testing, github, opensource, java. Disclose AI assistance if any was used.

Title: Green CI, hollow tests: what a PR check can see that CI cannot

First 300 words (about 300):

> A passing CI run tells you one thing: the tests that ran, passed. It does not tell you whether a test was deleted in the same PR, whether a skip was added, or whether the assertion that used to compare two values now only checks that something is not null.
>
> I spent six and a half years in test automation before moving to backend work, mostly in Java. The failure that bothered me most there was never a red build. It was a green build that had stopped proving anything. Reviewers see a diff of 400 lines of production code and a small test change, and the small test change is exactly where the meaning leaks out.
>
> Agent written pull requests make this more common, and I now see it every week. A June 2026 study of 86,156 agent authored test patches found 80.2% had weak or no explicit oracle. A second paper found that inaccurate self reporting is the failure mode that grows over time in real sessions. So a PR description can say all tests pass while nothing relevant ran.
>
> I wanted a reviewer to get the answer on the PR itself. The idea is simple. Take three things the PR already has: the git diff, the test source, and the JUnit XML from the test run. Compare the tests before and after, and compare what changed against what actually ran.
>
> That is testwitness, an open source GitHub Action and CLI for Java, TypeScript and JavaScript, and Python. It has no model, makes no network calls and never runs the code it scans. Every finding is a rule you can read, with the file, the line, and a before and after.
>
> In this post I will go through four cases it catches, show the output, and then be honest about where it is wrong today, with the numbers.

Outline for the rest:

1. Case one: a test skipped in the same PR as the change it covered (R003, 20 true positives and 0 false positives on the corpus).
2. Case two: assertEquals loosened to assertNotNull, and why that is hard to detect without a parsed inventory of assertions.
3. Case three: `continue-on-error` added to a test step, and failures hidden in the run command.
4. Case four: a changed test that never ran, and why the JUnit XML is the contract (which runners write it, and what to turn on for pytest, Jest and Vitest).
5. Why three states (pass, review, unreadable) and why it never says a PR lied.
6. Where it is wrong today: the assertion removed rule (precision 0.21, 19 false positives), the new test without an assertion rule (5 false positives, no true positives), the test deleted rule (0.63). Link to docs/precision.md.
7. Install block from the README, and a request for false positives, which become corpus entries before a fix merges.

---

## Hashnode

Rule read on 4 Nov 2026 at https://hashnode.com/terms (https://hashnode.com/content-policy returned a "User not found" page, so no content policy was read)

Rules in short: the Terms ban spam, including "unsolicited promotional content" and bulk messages, and automated content generation meant to manipulate search or engagement. There is no standalone self promotion rule. AI generated suggestions must be reviewed and approved by you before publishing.

Allowed? Yes. A real article about your own open source tool is not spam under the terms I read. Keep it an article, not an advert, and edit it by hand.

Different angle from dev.to, so the two do not read as copies: how a parsed test inventory tells a moved test from a deleted one.

Title: How to tell a moved test from a deleted one in a pull request

First 300 words (about 300):

> Here is a diff that looks bad. A test method is gone from OrderServiceTest.java, minus twenty lines. Is that a deletion that weakens the suite, or did someone move it?
>
> Plain diff text cannot answer that. A moved test and a deleted test both show up as removed lines. If you flag every removal you annoy reviewers, who turn the check off within a week. If you flag none you miss the thing you wanted to catch.
>
> I spent six and a half years in test automation, mostly Java, and I wrote testwitness because agent written pull requests kept leaving CI green while the tests stopped meaning anything. The hardest part was not finding removals. It was not crying wolf about honest refactors.
>
> The approach has three steps. First, parse the test file at the base and at the head with tree-sitter, and build an inventory: every test, its container, its markers, its assertions, and a hash of its body. Second, compare the two inventories, not the two texts. A removed test whose body hash or name appears elsewhere in the PR is a move. One folded into a parameterised test is a refactor. One whose assertions all survive is a refactor. Only a deletion with none of those signals gets reported as a deletion. Third, join the result with the JUnit XML from the run, so that you also know which tests actually executed.
>
> None of this needs a model. It is queries and tables, it runs offline, and any finding can be explained in a code review. The tool never runs the code it scans and makes no network calls.
>
> It still gets it wrong. The test deleted rule has precision 0.63 on a corpus of 101 public pull requests, with 9 false positives. This post walks through the controls that got it there, and the ones that did not work.

Outline for the rest:

1. A tiny inventory: what a TestInventory holds for a Java file and a Python file.
2. The five signals that keep a deletion low severity (moved, parameterised, rewritten, replaced, refactored), each with a short code example.
3. Why diff scope matters: a repo with hundreds of old skipped tests gets no finding until a PR adds one.
4. The corpus: how it is split by hash of the URL, what was never used to tune a rule, and what the held out half showed.
5. Where the controls still fail, with real false positives from docs/precision.md.
6. Pointer to the repo, install block, and an invitation to send false positives.

---

## JUnit GitHub Discussions and mailing list

Rule read on 4 Nov 2026 at https://github.com/junit-team/junit5/discussions (the JUnit code of conduct page at https://github.com/junit-team/junit5/blob/main/CODE_OF_CONDUCT.md failed to fetch, and I found no JUnit mailing list to read)

Rules in short: the Discussions page lists three categories, Announcements, General and Q&A. It shows no pinned guidance and no rule about third party tools or promotion. There is no Show and tell category.

Allowed? No clear place. Announcements is almost certainly maintainer use, but the page does not say so, and Q&A is for usage questions. A tool post in General or Q&A would be off topic by the categories as listed.

Do not post here. Reason: no category fits a tool announcement, nothing welcomes third party tools, and testwitness is not a JUnit extension. If a JUnit user asks how to detect skipped or deleted tests in review, a short reply linking the repo is better than a new thread.

---

## pytest GitHub Discussions and mailing list

Rule read on 4 Nov 2026 at https://github.com/pytest-dev/pytest/discussions and https://docs.pytest.org/en/stable/contact.html

Rules in short: categories are General, Ideas, Polls, Q&A and Show and tell. The page states no posting rules and no rule on promotion; the contents of the two pinned threads were not visible. The contact page lists a Discord server for general assistance and a "Testing In Python" mailing list for Python testing tools, with no announcement rules stated.

Allowed? Probably yes in Show and tell. Other people's plugin projects appear there, which suggests it is used for this, but no page says so. Conditions: stay relevant to pytest users, say clearly it is not a pytest plugin (it reads the junitxml output), and keep it short. Read the two pinned threads before posting. Do not post to the mailing list or Discord until their rules are read.

Category: Show and tell

Title: testwitness: a PR check that reads pytest's junitxml and flags skipped, deleted and never run tests

Body:

> I spent six and a half years in test automation, and I built a GitHub Action and CLI called testwitness because agent written PRs kept leaving CI green while the tests stopped meaning anything.
>
> It is not a pytest plugin. It reads the PR diff, the test source (tree-sitter) and the file you get from `pytest --junitxml`, and comments on the PR whether a test was deleted, skipped, marked xfail, loosened, or changed without running. pytest and unittest are both covered. There is no model, no network and it never runs your code.
>
> What it gets wrong today: on 101 public pull requests the assertion removed rule has precision 0.21 (19 false positives), and an assertion helper that does not follow a naming convention needs a line of config. Per rule numbers are in docs/precision.md.
>
> Repo: [repo URL]. I would like to hear about pytest idioms it misreads (fixtures that assert, parametrize with ids, plugins that rewrite test names).

---

## Jest GitHub Discussions and Discord

Rule read on 4 Nov 2026 at https://github.com/jestjs/jest/discussions (the Discord was not read, no public page found, invites need a login)

Rules in short: categories are Announcements, General, Ideas, Polls, Q&A and Show and tell. The page gives no posting rules and says nothing on promotion; it links the project's code of conduct, which I did not read. A Show and tell post introducing a CLI tool for AI agent teams is visible there.

Allowed? Probably yes in Show and tell. Conditions: it should be something Jest users can use, so lead with the jest-junit requirement. Read the code of conduct and any category description in the GitHub UI before posting.

Category: Show and tell

Title: testwitness: a PR check for skipped, loosened and never run Jest tests

Body:

> I spent six and a half years in test automation, and testwitness came from agent written PRs that kept CI green while the tests stopped meaning anything.
>
> It is a GitHub Action and CLI that reads the PR diff, the test source and the JUnit XML from the run (for Jest that means jest-junit). It flags `.skip`, `.only`, `xit`, loosened `expect` calls, empty tests and tests that changed but did not run. No model, no network, and it never runs your code.
>
> What it gets wrong today: on 101 public pull requests the assertion removed rule has precision 0.21, and custom assertion helpers need a line in `.testwitness.yml`. The skipped test rule found 20 true positives and 0 false positives, across all languages. Numbers are in docs/precision.md.
>
> Repo: [repo URL]. Which Jest patterns should I test it against next?

---

## Vitest GitHub Discussions and Discord

Rule read on 4 Nov 2026 at https://github.com/vitest-dev/vitest/discussions and https://github.com/vitest-dev/vitest/blob/main/CODE_OF_CONDUCT.md (the Discord was not read, no public page found, invites need a login)

Rules in short: categories are Announcements, Feedback, General, Ideas, Polls, Q&A and Show and tell. The page states no posting rules. Show and tell holds projects built with or tested by Vitest, and the code of conduct says nothing about promotion or spam.

Allowed? Probably yes in Show and tell, with the same caveat: it holds projects built with or tested by Vitest, and testwitness is a tool that reads Vitest's JUnit output, so make that connection plain. Conditions: lead with `--reporter=junit`, keep it short, and do not use Announcements.

Category: Show and tell

Title: testwitness: a PR check that reads Vitest's junit reporter and flags weakened tests

Body:

> I spent six and a half years in test automation, and I built testwitness because agent written PRs kept CI green while the tests stopped meaning anything.
>
> It is a GitHub Action and CLI. It reads the PR diff, the test source and the file from `vitest --reporter=junit`, and tells the reviewer if a test was skipped, focused with `.only`, deleted, loosened or changed without running. No model, no network, and it never runs your code.
>
> What it gets wrong today: on 101 public pull requests the assertion removed rule has precision 0.21 (19 false positives), and the new test without an assertion rule had 5 false positives and no true positives. Details in docs/precision.md.
>
> Repo: [repo URL]. If you have a Vitest setup that it misreads, I would like to add it to the corpus.

---

## Changelog News

Rule read on 4 Nov 2026 at https://changelog.com/news/submit

Rules in short: submissions should be interesting to developers and should say why the item is newsworthy. How tos, tutorials and commercial products or services are excluded. Tone should be positive and hacker oriented. "Submitting your own work is also encouraged", and you get an email if it is published.

Allowed? Yes. Testwitness is a free, Apache 2.0 open source tool with no hosted service, so the commercial exclusion does not apply. Condition: it must not read as a tutorial or an advert, and the newsworthiness line has to carry real weight. Submit it close to when the repo goes public, with a working install.

Submission (link): [repo URL]

Newsworthiness note (about 110 words):

> Agent written PRs are making a quiet failure common: CI stays green while the tests stop proving anything. testwitness is an open source GitHub Action and CLI that reads the diff, the test source and the JUnit XML and tells the reviewer whether tests were deleted, skipped, loosened or never ran. There is no model in it, no network, and it never runs the code. The part I think is worth a look is that precision is published per rule on a corpus of 101 public pull requests, including the rules that are bad today (the assertion removed rule is at 0.21). Java, TypeScript and JavaScript, and Python.

---

## awesome-actions

Rule read on 4 Nov 2026 at https://github.com/sdras/awesome-actions and https://raw.githubusercontent.com/sdras/awesome-actions/main/contributing.md

Rules in short: entries are added by pull request, one PR per suggestion, with a descriptive PR and commit title (titles like "Update readme.md" get closed), and a link to the repository in the commit message body. Descriptions stay short, ideally one line, no bold or italics, search for duplicates first, check spelling, use Title Case, and add the entry to the end of the most relevant category.

Allowed? Yes, by pull request. No account age, ratio or star count is stated in what I read, though the maintainers may still decline an entry. The README header shows a lint workflow, so run the format exactly as below. Wait until the Action is published and the repo is public.

Section: Community Resources, Static Analysis, Testing (add to the end of that subsection)

Line to add (the dash after the link is the list's own entry format):

```
- [Testwitness](https://github.com/testwitness/testwitness) - Reports when a pull request deletes, skips, loosens or never runs its tests.
```

Confirm the URL matches [repo URL] before submitting.

PR title: Add Testwitness to Static Analysis, Testing

Commit message:

```
Add Testwitness to Static Analysis, Testing

https://github.com/testwitness/testwitness
```

PR description:

> Adds testwitness to Static Analysis, Testing. It is an Action that reads a PR's diff, test source and JUnit XML and reports tests that were deleted, skipped, loosened or never ran. No secrets, no network. I checked the list for an existing entry and found none.
