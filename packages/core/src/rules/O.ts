import type { Finding, Rule, TestCase } from '../types.js';
import { allChanges, isSkipped, isXfail } from '../inventory.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

const SMOKE_NAME = /contextloads|smoke|doesnotthrow|does_not_throw|does_not_raise|noexception|sanity/i;

/** O001 New test without an assertion. */
export const O001: Rule = {
  id: 'O001',
  name: 'New test without an assertion',
  group: 'O',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A test added in this PR has no assertion: no framework assertion, no exception expectation, no snapshot, and no call to an assertion helper defined in the file or configured in assertions.extra.',
    falsePositives:
      'Smoke tests named contextLoads, smoke or DoesNotThrow are reported low with the label smoke. Helpers whose body contains an assertion are counted as assertions one level deep. Tests delegating to helpers in another module need assertions.extra. Assertions inside nested scopes of the test body (callbacks, lambdas, anonymous and local classes, inner functions) are counted. The default is medium, not high: on public PRs half of the new tests without an assertion were intentional smoke tests (race tests, verbose output tests, does not throw tests), so the rule cannot carry high.',
    example: '+  @Test\n+  void processesBatch() {\n+    service.process(batch);\n+  }',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (t.assertions.length > 0) continue;
      if (t.statementCount === 0) continue; // an empty new test is a todo, not an oracle problem; R010 covers marked ones
      if (t.overrideOnly) continue; // the inherited test carries the oracle
      if (isSkipped(t) || isXfail(t)) continue;
      const smoke = SMOKE_NAME.test(t.name);
      out.push(
        makeFinding(ctx, 'O001', smoke ? 'low' : 'medium', pair.file, t.qualifiedName, `New test ${t.qualifiedName} has no assertion`, {
          line: t.startLine,
          endLine: t.endLine,
          ...(smoke ? { label: 'smoke' } : {}),
          snippet: t.bodyHash,
        }),
      );
    }
    return out;
  },
};

function onlySmoke(t: TestCase): boolean {
  return t.assertions.length > 0 && t.assertions.every((a) => a.kind === 'smoke' || a.kind === 'snapshot');
}

/** O002 New test with a smoke oracle only. */
export const O002: Rule = {
  id: 'O002',
  name: 'New test with a smoke oracle only',
  group: 'O',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A new test whose only assertions are existence or type checks (toBeDefined, assertNotNull, isNotNone, not.toThrow, assertDoesNotThrow) or a bare snapshot. It proves the code ran, not what it did.',
    falsePositives: 'A test that is meant as a smoke test. Reported low by default; medium when the PR text calls it a regression test.',
    example: "+  it('computes the discount', () => {\n+    expect(computeDiscount(cart)).toBeDefined();\n+  });",
  },
  run(ctx) {
    const out: Finding[] = [];
    const regression = ctx.prText ? /\bregression\b|\bfix(es|ed)?\b.*\btests?\b/i.test(`${ctx.prText.title}\n${ctx.prText.body}`) : false;
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (!onlySmoke(t)) continue;
      if (isSkipped(t) || isXfail(t)) continue;
      const kinds = [...new Set(t.assertions.map((a) => a.callee))].join(', ');
      out.push(
        makeFinding(ctx, 'O002', regression ? 'medium' : 'low', pair.file, t.qualifiedName, `New test ${t.qualifiedName} only checks existence or a snapshot (${kinds})`, {
          line: t.startLine,
          endLine: t.endLine,
          label: 'smoke',
          snippet: t.bodyHash,
        }),
      );
    }
    return out;
  },
};

/** O006 New test file with no tests collected. */
export const O006: Rule = {
  id: 'O006',
  name: 'New test file with no tests collected',
  group: 'O',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A new file matching test patterns defines no collectable test (wrong name prefix, missing @Test, describe without it). It reads as coverage and runs nothing.',
    falsePositives: 'Shared test helpers and fixtures placed in a tests directory. Add them to paths.ignore or name them so they do not match test patterns.',
    example: '+// tests/helpers.test.ts\n+export function makeUser() { ... }',
  },
  async run(ctx) {
    const out: Finding[] = [];
    for (const pair of ctx.pairs) {
      if (pair.file.status !== 'added' || !pair.head) continue;
      if (pair.head.tests.length > 0) continue;
      if (pair.head.parseErrors > 0) continue;
      // A concrete subclass of an abstract test base inherits its tests; the per file inventory cannot see them.
      if (pair.file.language === 'java') {
        const src = (await ctx.readHead(pair.file.path)) ?? '';
        if (/\bclass\s+\w+\s+extends\s+\w+/.test(src) && !/\babstract\s+class\b/.test(src)) continue;
      }
      // Helper only files: exports with assertion helpers and nothing else are still "no tests"; report.
      out.push(
        makeFinding(ctx, 'O006', 'medium', pair.file, pair.file.path, `New test file ${pair.file.path} defines no tests the runner would collect`, { snippet: 'no-tests' }),
      );
    }
    return out;
  },
};

export function rulesO(): Rule[] {
  return [O001, O002, O006];
}
