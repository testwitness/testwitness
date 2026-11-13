import type { Finding, Rule, Severity, TestCase } from '../types.js';
import { allChanges, isSkipped, isXfail } from '../inventory.js';
import { inventoryKeys } from '../evidence/normalise.js';
import { findClaims, type Claim } from '../evidence/claims.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

function langOf(pair: { file: { language?: string } }): 'java' | 'typescript' | 'javascript' | 'python' {
  return (pair.file.language ?? 'typescript') as 'java' | 'typescript' | 'javascript' | 'python';
}

/** Turn a normalised key holding a printf or $variable template into a regex that matches formatted rows. */
export function templateRegex(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/%[sdifjop#]/g, '.+?').replace(/\\\$\w+/g, '.+?') + '$');
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
    summary: 'A test added or modified by the PR has no record in the JUnit XML of this run. Names are normalised across Surefire, Gradle, pytest, jest-junit, Vitest, Playwright and Mocha producers.',
    falsePositives:
      'Tests in a matrix leg whose XML was not uploaded; parametrised or dynamic names the normaliser missed. When no test from the same file ran the finding is medium with the label file not in results. When fewer than half of the changed test files appear in the results at all, every finding in this group is low with the label partial results.',
    example: 'Modified test CartTest#handlesEmpty has no testcase record in 3 result files (42 tests).',
    history:
      'A finding on a test recorded in every one of the last 5 runs of the history becomes high with the label ran before, not now. A test the history has never seen, or that is missing from any of those 5 runs, keeps the severity above, and a finding labelled partial results stays low. A history with fewer than 5 runs changes nothing.',
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
        // test.each / it.each titles are printf style templates; the producer writes the formatted rows.
        if (/%[sdifjop#]|\$\w+/.test(t.qualifiedName)) {
          const res = keys.map(templateRegex);
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

function classify(claim: Claim, ctx: Parameters<Rule['run']>[0]): 'supported' | 'unsupported' | 'unreadable' {
  const ev = ctx.evidence;
  const addedTests = allChanges(ctx.pairs).filter((c) => c.change.kind === 'added').length;
  switch (claim.kind) {
    case 'added-tests':
      return addedTests > 0 ? 'supported' : 'unsupported';
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
    falsePositives: 'Claims quoted from a template or inside code blocks (stripped), negated claims (skipped). Wording is always "not supported by the results attached to this run".',
    example: 'PR body says "all tests pass"; results show 2 failures.',
  },
  run(ctx) {
    if (!ctx.prText || !ctx.config.claims.enabled) return [];
    const claims = findClaims(`${ctx.prText.title}\n${ctx.prText.body}`, ctx.config.claims.phrasesExtra);
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
    summary: 'The PR touches tests or test configuration and no JUnit XML was found. The evidence section reads unreadable and changed tests cannot be checked against what ran.',
    falsePositives: 'None: this is an instruction to add a reporter (--junitxml, jest-junit, the Playwright junit reporter, Surefire writes it by default).',
    example: 'No JUnit XML matched **/junit*.xml.',
  },
  run(ctx) {
    if (ctx.evidence) return [];
    const touches = ctx.files.some((f) => f.kind === 'test' || f.kind === 'runner-config' || f.kind === 'ci-workflow');
    if (!touches) return [];
    return [makeFinding(ctx, 'V005', 'low', 'results', 'none', 'No JUnit XML found for this run. Add a reporter (pytest --junitxml, jest-junit, Playwright junit reporter; Surefire and Gradle write it by default) so changed tests can be checked against what ran.', { label: 'unreadable', snippet: 'no-xml' })];
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
