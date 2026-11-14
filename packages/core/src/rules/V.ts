import { replaceDelimited } from '../linear.js';
import type { ChangedFile, Finding, Rule, Severity, TestCase } from '../types.js';
import { allChanges, isSkipped, isXfail } from '../inventory.js';
import { inventoryKeys } from '../evidence/normalise.js';
import { findClaims, type Claim } from '../evidence/claims.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

function langOf(pair: { file: { language?: string } }): 'java' | 'typescript' | 'javascript' | 'python' {
  return (pair.file.language ?? 'typescript') as 'java' | 'typescript' | 'javascript' | 'python';
}

/** Placeholders a template key may hold; a key with more is matched by its literal prefix only. */
export const TEMPLATE_MAX_PLACEHOLDERS = 12;

/**
 * Turn a normalised key holding a printf or $variable template into a matcher for formatted rows: each placeholder
 * stands for one or more characters, as `.+?` did. It used to be a regex `^a.+?b.+?c$`, which backtracks
 * combinatorially when a row almost matches (a key of twelve `%s` against a long name did not finish in two minutes).
 * Literals between placeholders are found leftmost, which is exact for patterns of literals and `.+` gaps, so a match
 * costs one pass over the row. A key with more than TEMPLATE_MAX_PLACEHOLDERS placeholders matches by the literal
 * text before its first placeholder.
 */
export function templateRegex(key: string): { test(row: string): boolean } {
  const literals = key.split(/%[sdifjop#]|\$\w+/);
  const holes = literals.length - 1;
  if (holes > TEMPLATE_MAX_PLACEHOLDERS) return { test: (row) => row.startsWith(literals[0]!) };
  return {
    test(row: string): boolean {
      // `.` never matched a line terminator; keys are whitespace collapsed, so a row with one cannot match a gap.
      if (holes === 0) return row === key;
      if (/[\n\r\u2028\u2029]/.test(row)) return false;
      const first = literals[0]!;
      const last = literals[holes]!;
      if (!row.startsWith(first) || !row.endsWith(last)) return false;
      let pos = first.length;
      for (let i = 1; i < holes; i++) {
        const at = row.indexOf(literals[i]!, pos + 1);
        if (at < 0) return false;
        pos = at + literals[i]!.length;
      }
      return row.length - last.length >= pos + 1;
    },
  };
}

/**
 * A title the front end kept as template literal source (`case ${c.name}`) as a printf style template: the backticks
 * go and each interpolation becomes one placeholder. Other titles are returned unchanged.
 */
export function templateTitle(qualifiedName: string): string {
  if (!qualifiedName.includes('`')) return qualifiedName;
  return qualifiedName.replace(/`([^`]*)`/g, (whole, inner: string) => (inner.includes('${') ? replaceDelimited(inner, '${', '}', '%s') : whole));
}

/** V003 Changed test did not run. */
export const V003: Rule = {
  id: 'V003',
  name: 'Changed test did not run',
  group: 'V',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast', 'junit'],
  docs: {
    summary: 'A test added or modified by the PR has no record in the test results of this run (JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright). Names are normalised across Surefire, Gradle, pytest, jest-junit, Vitest, Playwright, Mocha and Node test runner producers.',
    falsePositives:
      'Tests in a matrix leg whose results were not uploaded; parametrised or dynamic names the normaliser missed. When no test from the same file ran the finding is medium with the label file not in results. When fewer than half of the changed test files appear in the results at all, every finding in this group is low with the label partial results.',
    example: 'Modified test CartTest#handlesEmpty has no testcase record in 3 result files (42 tests).',
  },
  run(ctx) {
    const ev = ctx.evidence;
    if (!ev) return [];
    const out: Finding[] = [];
    interface Miss {
      pair: (typeof ctx.pairs)[number];
      test: TestCase;
      fileRan: boolean;
    }
    const misses: Miss[] = [];
    let filesChecked = 0;
    let filesWithResults = 0;
    for (const pair of ctx.pairs) {
      if (!pair.head || pair.file.status === 'deleted') continue;
      const lang = langOf(pair);
      const ran = (t: TestCase) => {
        const keys = inventoryKeys(pair.file.path, t.qualifiedName, lang);
        if (keys.some((k) => ev.has(k))) return true;
        // test.each / it.each titles are printf style templates, and a title written as a template literal in a loop
        // (`it(`case ${name}`)`) is one too; the producer writes the formatted rows.
        const name = templateTitle(t.qualifiedName);
        if (/%[sdifjop#]|\$\w+/.test(name)) {
          const res = (name === t.qualifiedName ? keys : inventoryKeys(pair.file.path, name, lang)).map(templateRegex);
          for (const k of ev.keys()) if (res.some((re) => re.test(k))) return true;
        }
        return false;
      };
      const anyRan = pair.head.tests.some(ran);
      filesChecked++;
      if (anyRan) filesWithResults++;
      for (const { change } of allChanges([pair])) {
        if (change.kind !== 'added' && change.kind !== 'modified' && change.kind !== 'renamed') continue;
        const t = change.head;
        if (isSkipped(t) || isXfail(t)) continue; // not expected to run
        if (ran(t)) continue;
        misses.push({ pair, test: t, fileRan: anyRan });
      }
    }
    const partial = filesChecked > 1 && filesWithResults * 2 < filesChecked;
    for (const m of misses) {
      let sev: Severity = m.fileRan ? 'high' : 'medium';
      let label: string | undefined = m.fileRan ? undefined : 'file not in results';
      if (partial) {
        sev = 'low';
        label = 'partial results';
      }
      out.push(
        makeFinding(ctx, 'V003', sev, m.pair.file, m.test.qualifiedName, `Changed test ${m.test.qualifiedName} has no record in the ${ev.sources.length} result file${ev.sources.length === 1 ? '' : 's'} read (${ev.total} tests)`, {
          line: m.test.startLine,
          ...(label ? { label } : {}),
          snippet: 'not-run',
        }),
      );
    }
    return out;
  },
};

/** New assertions in existing tests that, from this many on, count as added tests: a new check with its setup, not one tweak. */
export const V004_MIN_ADDED_ASSERTIONS = 2;

/**
 * Does the diff add tests in any form a runner reports or a reviewer counts: a new test declaration, new cases in a
 * parameter table (test.each rows, parametrize entries), new entries in a snapshot file (a fixture driven suite whose
 * tests are generated from input files), or at least two new assertions inside existing tests.
 */
function diffAddsTests(ctx: Parameters<Rule['run']>[0]): boolean {
  let assertionsAdded = 0;
  for (const { change } of allChanges(ctx.pairs)) {
    if (change.kind === 'added') return true;
    if (change.kind === 'deleted') continue;
    const { base, head } = change;
    if (base.parameterCount !== undefined && head.parameterCount !== undefined && head.parameterCount > base.parameterCount) return true;
    const before = new Map<string, number>();
    for (const a of base.assertions) before.set(assertionKey(a.text), (before.get(assertionKey(a.text)) ?? 0) + 1);
    for (const a of head.assertions) {
      const k = assertionKey(a.text);
      const n = before.get(k) ?? 0;
      if (n > 0) before.set(k, n - 1);
      else assertionsAdded++;
    }
    // Only count growth: a rewritten assertion replaces one, it adds none.
  }
  if (assertionsAdded >= V004_MIN_ADDED_ASSERTIONS && assertionsAdded > removedAssertions(ctx)) return true;
  return ctx.files.some((f) => f.kind === 'snapshot' && snapshotEntriesAdded(f) > 0);
}

function assertionKey(text: string): string {
  return text.replace(/\s+/g, '');
}

function removedAssertions(ctx: Parameters<Rule['run']>[0]): number {
  let n = 0;
  for (const { change } of allChanges(ctx.pairs)) {
    if (change.kind === 'deleted' || change.kind === 'added') continue;
    const after = new Map<string, number>();
    for (const a of change.head.assertions) after.set(assertionKey(a.text), (after.get(assertionKey(a.text)) ?? 0) + 1);
    for (const a of change.base.assertions) {
      const k = assertionKey(a.text);
      const c = after.get(k) ?? 0;
      if (c > 0) after.set(k, c - 1);
      else n++;
    }
  }
  return n;
}

/** Snapshot entries the diff adds net: Jest and Vitest `exports[...]` keys, syrupy `# name:` headers; a new snapshot file counts as one. */
function snapshotEntriesAdded(f: ChangedFile): number {
  const entry = /^(exports\[|# name: )/;
  let added = 0;
  let removed = 0;
  for (const h of f.hunks) {
    added += h.added.filter((l) => entry.test(l)).length;
    removed += h.removed.filter((l) => entry.test(l)).length;
  }
  if (f.status === 'added') return Math.max(1, added);
  return added - removed;
}

function classify(claim: Claim, ctx: Parameters<Rule['run']>[0]): 'supported' | 'unsupported' | 'unreadable' {
  const ev = ctx.evidence;
  switch (claim.kind) {
    case 'added-tests':
      return diffAddsTests(ctx) ? 'supported' : 'unsupported';
    case 'no-test-changes':
      return ctx.pairs.length === 0 ? 'supported' : 'unsupported';
    case 'tests-pass':
    case 'ci-green':
    case 'ran-suite':
    case 'verified':
    case 'tested-locally':
      if (!ev) return 'unreadable';
      if (ev.total === 0) return 'unreadable';
      return ev.failed + ev.errored === 0 ? 'supported' : 'unsupported';
    case 'full-coverage':
      return 'unreadable';
  }
}

/** V004 Claim in PR text not supported by results. */
export const V004: Rule = {
  id: 'V004',
  name: 'Claim in PR text not supported by results',
  group: 'V',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast', 'prtext'],
  docs: {
    summary: 'The PR title or body claims that tests pass, that tests were added, or that nothing changed in tests, and the diff or the attached results do not support it. Claims that cannot be checked are reported as unreadable (low), never as false.',
    falsePositives:
      'Claims inside code blocks and HTML comments are stripped, and so is every unchecked checklist line. A checked checklist line is template text too ("- [x] Add test case(s)" ticks a reminder) and is read as an added tests claim only when the PR changes no test file at all. Negated claims are skipped, including a negation later on the same line ("Added tests: not applicable", "no new test"). An "added tests" claim is supported by a new test, by new rows in a parameter table (test.each, parametrize), by new entries in a snapshot file (fixture driven suites such as runFormatTest generate their tests from input files) and by two or more new assertions inside existing tests. Wording is always "not supported by the results attached to this run".',
    example: 'PR body says "all tests pass"; results show 2 failures.',
  },
  run(ctx) {
    if (!ctx.prText || !ctx.config.claims.enabled) return [];
    // A ticked template box is template text, unless the PR touches no test file at all: then "I have added tests"
    // ticked on a PR without a test change is a claim worth checking.
    const touchesTests = ctx.files.some((f) => f.kind === 'test');
    const claims = findClaims(`${ctx.prText.title}\n${ctx.prText.body}`, ctx.config.claims.phrasesExtra, { checklistClaims: !touchesTests });
    const out: Finding[] = [];
    for (const c of claims) {
      const verdict = classify(c, ctx);
      if (verdict === 'supported') continue;
      if (verdict === 'unreadable') {
        out.push(makeFinding(ctx, 'V004', 'low', 'PR', c.kind, `Claim "${c.text}" could not be checked: no test results were attached to this run`, { label: 'unreadable', snippet: c.kind }));
        continue;
      }
      const why =
        c.kind === 'added-tests' ? 'the diff adds no test' : c.kind === 'no-test-changes' ? `the diff changes ${ctx.pairs.length} test file${ctx.pairs.length === 1 ? '' : 's'}` : `results show ${ctx.evidence!.failed} failed and ${ctx.evidence!.errored} errored`;
      out.push(makeFinding(ctx, 'V004', 'medium', 'PR', c.kind, `Claim "${c.text}" is not supported by the results attached to this run: ${why}`, { label: 'unsupported', snippet: c.kind }));
    }
    return out;
  },
};

/** V006 Failures in results while the PR claims passing. */
export const V006: Rule = {
  id: 'V006',
  name: 'Failures in results while the PR claims passing',
  group: 'V',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['junit', 'prtext'],
  docs: {
    summary: 'The attached results contain failures or errors and the PR text claims the tests pass.',
    falsePositives: 'Results from a different run than the one the author describes. Attach the XML from the head commit.',
    example: 'PR body: "all tests pass". junit.xml: 3 failures.',
  },
  run(ctx) {
    const ev = ctx.evidence;
    if (!ev || !ctx.prText || !ctx.config.claims.enabled) return [];
    if (ev.failed + ev.errored === 0) return [];
    const claims = findClaims(`${ctx.prText.title}\n${ctx.prText.body}`, ctx.config.claims.phrasesExtra).filter((c) => c.kind === 'tests-pass' || c.kind === 'ci-green' || c.kind === 'ran-suite');
    if (!claims.length) return [];
    return [
      makeFinding(ctx, 'V006', 'high', 'PR', 'tests-pass', `Results show ${ev.failed} failed and ${ev.errored} errored tests while the PR says "${claims[0]!.text}"`, { snippet: 'failures-vs-claim' }),
    ];
  },
};

/** V005 No test results found (informational). */
export const V005: Rule = {
  id: 'V005',
  name: 'No test results found',
  group: 'V',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff'],
  docs: {
    summary: 'The PR touches tests or test configuration and no test results were found. The evidence section reads unreadable and changed tests cannot be checked against what ran.',
    falsePositives: 'None: this is an instruction to add a reporter (JUnit XML first: --junitxml, jest-junit, the Playwright junit reporter, Surefire writes it by default; TAP and the Jest, Vitest, pytest-json-report and Playwright JSON reporters are read too).',
    example: 'No test results matched **/junit*.xml.',
  },
  run(ctx) {
    if (ctx.evidence) return [];
    const touches = ctx.files.some((f) => f.kind === 'test' || f.kind === 'runner-config' || f.kind === 'ci-workflow');
    if (!touches) return [];
    return [makeFinding(ctx, 'V005', 'low', 'results', 'none', 'No test results found for this run. Add a reporter (JUnit XML first: pytest --junitxml, jest-junit, Playwright junit reporter; Surefire and Gradle write it by default; TAP and the Jest, Vitest, pytest-json-report and Playwright JSON reporters are read too) so changed tests can be checked against what ran.', { label: 'unreadable', snippet: 'no-xml' })];
  },
};

/** Changed production files V008 looks at, at most. */
export const V008_MAX_FILES = 200;

/** V008 Changed production lines not executed. */
export const V008: Rule = {
  id: 'V008',
  name: 'Changed production lines not executed',
  group: 'V',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'coverage'],
  docs: {
    summary:
      'Coverage reports of the head run (lcov, Cobertura such as coverage.py coverage.xml, JaCoCo XML; the coverage input, --coverage or coverage.paths) say that lines this PR added or changed in a production file were instrumented but never executed by any test. One finding per file with the count and the first three line numbers, label uncovered change. Nothing is reported when no coverage report is attached.',
    falsePositives:
      'Only lines the coverage tool instrumented count, so comments, blank lines, declarations and files missing from the report are never reported. Reports from a partial run (one matrix leg, a sharded suite) under count execution; attach every shard. At most 200 changed production files are checked and at most 200 report files or 50 MB of coverage data are read.',
    example: 'src/billing/refund.py: 4 changed lines never executed by the tests (lines 42, 43, 57 and 1 more).',
  },
  run(ctx) {
    const cov = ctx.coverage;
    if (!cov) return [];
    const out: Finding[] = [];
    const files = ctx.files.filter((f) => f.kind === 'production' && f.status !== 'deleted' && !f.binary).slice(0, V008_MAX_FILES);
    for (const f of files) {
      const c = cov.lookup(f.path);
      if (!c || c.instrumented.size === 0) continue;
      const missed = [...f.addedLines].filter((l) => c.instrumented.has(l) && !c.executed.has(l)).sort((a, b) => a - b);
      if (!missed.length) continue;
      const first = missed.slice(0, 3).join(', ');
      const more = missed.length > 3 ? ` and ${missed.length - 3} more` : '';
      out.push(
        makeFinding(ctx, 'V008', 'low', f, f.path, `${missed.length} changed line${missed.length === 1 ? '' : 's'} in ${f.path} never executed by the tests (line${missed.length === 1 ? '' : 's'} ${first}${more})`, {
          line: missed[0]!,
          label: 'uncovered change',
        }),
      );
    }
    return out;
  },
};

export function rulesV(): Rule[] {
  return [V003, V004, V005, V006, V008];
}
