import type { Finding, Rule, RuleContext, Severity, TestCase } from '../types.js';
import { allChanges, isFocused, isSkipped, isXfail, lower, reasonReferencesIssue, markersKey } from '../inventory.js';
import { assertionKeyOf, exercisesChangedProduction, headIndex, makeFinding, subjectRemoved, type HeadIndex } from './util.js';

const RULE_SINCE = '0.1.0';

function snippet(t: TestCase): string {
  return `${t.qualifiedName}|${t.bodyHash}`;
}

/** Path of a changed head file that contains every assertion of the test, when the test has assertions. */
function refactoredInto(t: TestCase, index: HeadIndex): string | undefined {
  if (t.assertions.length === 0) return undefined;
  let common: Set<string> | undefined;
  for (const a of t.assertions) {
    const owners = index.assertionOwners.get(assertionKeyOf(a.text));
    if (!owners) return undefined;
    common = common ? new Set([...common].filter((p) => owners.has(p))) : new Set(owners);
    if (common.size === 0) return undefined;
  }
  return common ? [...common][0] : undefined;
}

/** R001 Test function deleted. */
export const R001: Rule = {
  id: 'R001',
  name: 'Test function deleted',
  group: 'R',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A test present in the base is absent in the head and no test with the same body exists elsewhere in the head tree.',
    falsePositives:
      'Renamed tests with the same body are not reported. Reported low with a label when the test was moved to another file (same body, or same name added elsewhere in the PR), folded into a parameterised test whose case count covers the removed tests, rewritten (other changed test files gained at least as many tests as the PR deleted), replaced (its class or group gained as many new tests as it lost) or refactored (every assertion survives in a changed file). Precision over recall: a deletion is medium or high only when none of those signals is present.',
    example: '-  @Test\n-  void rejectsNegativeAmount() {\n-    assertThrows(IllegalArgumentException.class, () -> svc.charge(-1));\n-  }',
  },
  async run(ctx) {
    const out: Finding[] = [];
    let index: HeadIndex | undefined;
    const prChanges = allChanges(ctx.pairs);
    const addedByFile = new Map<string, number>();
    let deletedTotal = 0;
    for (const { pair, change } of prChanges) {
      if (change.kind === 'added') addedByFile.set(pair.file.path, (addedByFile.get(pair.file.path) ?? 0) + 1);
      if (change.kind === 'deleted' && pair.file.status !== 'deleted') deletedTotal++;
    }
    for (const { pair, change } of prChanges) {
      if (change.kind !== 'deleted') continue;
      // Deleted files are reported by R002; skip here unless the file is only modified/renamed.
      if (pair.file.status === 'deleted') continue;
      const t = change.base;
      index ??= await headIndex(ctx);
      if (subjectRemoved(pair.base, pair.file.path, ctx)) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was deleted together with the production code it exercised`, {
            label: 'production removed',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      const moved = t.statementCount > 0 ? index.byHash.get(t.bodyHash)?.filter((m) => m.path !== pair.file.path || m.test.qualifiedName !== t.qualifiedName) : undefined;
      if (moved && moved.length) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was moved to ${moved[0]!.path}`, {
            label: 'moved',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // Parametrisation fold: a head test in the same container gained parameter cases at least equal to deletions.
      const deletedInContainer = allChanges([pair]).filter(
        (c) => c.change.kind === 'deleted' && c.change.base.container.join('/') === t.container.join('/'),
      ).length;
      const fold = (pair.head?.tests ?? []).find((h) => {
        if (h.container.join('/') !== t.container.join('/')) return false;
        const b = pair.base?.tests.find((x) => x.qualifiedName === h.qualifiedName);
        const before = b?.parameterCount ?? (b ? 1 : 0);
        if ((h.parameterCount ?? 0) >= before + deletedInContainer) return true;
        // Dynamic source (MethodSource, a variable): the test became parameterised in this PR and the count is unknown.
        return h.parameterised === true && h.parameterCount === undefined && !(b?.parameterised);
      });
      if (fold) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} appears folded into parameterised test ${fold.qualifiedName}`, {
            label: 'parameterised',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // Moved with edits: a test with the same name was added in another changed file of this PR.
      const dests = [...(index.addedByName.get(t.name) ?? [])].filter((d) => d !== pair.file.path);
      if (dests.length) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was moved to ${dests[0]} with edits`, {
            label: 'moved',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // Rewritten across files: other changed test files in this PR gained at least as many tests as the PR deleted.
      const addedElsewhere = [...addedByFile.entries()].filter(([p]) => p !== pair.file.path).reduce((n, [, c]) => n + c, 0);
      if (addedElsewhere >= deletedTotal && addedElsewhere > 0) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was removed while ${addedElsewhere} new test${addedElsewhere === 1 ? '' : 's'} were added in other changed test files; likely rewritten`, {
            label: 'rewritten',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // Replacement: the same container gained at least as many new tests as it lost (rewritten tests under new names).
      const addedInContainer = allChanges([pair]).filter((c) => c.change.kind === 'added' && c.change.head.container.join('/') === t.container.join('/')).length;
      if (addedInContainer >= deletedInContainer && addedInContainer > 0) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was removed while ${addedInContainer} new test${addedInContainer === 1 ? '' : 's'} were added in the same ${t.container.length ? 'class or group' : 'file'}`, {
            label: 'replaced',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // Refactor: every assertion of the deleted test survives in a test of a changed file (split, merge, rename with edits).
      const kept = refactoredInto(t, index);
      if (kept) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was removed but all ${t.assertions.length} of its assertions appear in ${kept}`, {
            label: 'refactored',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      const sev: Severity = exercisesChangedProduction(pair.base, pair.file.path, ctx) ? 'high' : 'medium';
      out.push(
        makeFinding(ctx, 'R001', sev, pair.file, t.qualifiedName, `Test ${t.qualifiedName} was deleted`, {
          line: t.startLine,
          endLine: t.endLine,
          before: t.qualifiedName,
          snippet: snippet(t),
        }),
      );
    }
    return out;
  },
};

/** R002 Test file deleted. */
export const R002: Rule = {
  id: 'R002',
  name: 'Test file deleted',
  group: 'R',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A file matching test patterns was deleted. The number of tests lost is counted from the base inventory.',
    falsePositives: 'A file whose tests all reappear elsewhere in the head tree (same bodies) is reported low as moved. Git rename detection handles pure moves before this rule runs.',
    example: 'deleted file mode 100644 src/__tests__/billing.test.ts',
  },
  async run(ctx) {
    const out: Finding[] = [];
    for (const pair of ctx.pairs) {
      if (pair.file.status !== 'deleted') continue;
      const tests = pair.base?.tests ?? [];
      if (tests.length === 0) continue;
      if (subjectRemoved(pair.base, pair.file.path, ctx)) {
        out.push(makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted together with the production code it exercised (${tests.length} tests)`, { label: 'production removed' }));
        continue;
      }
      const index = await headIndex(ctx, pair.file.path);
      const movedCount = tests.filter((t) => t.statementCount > 0 && (index.byHash.has(t.bodyHash) || refactoredInto(t, index))).length;
      if (movedCount === tests.filter((t) => t.statementCount > 0).length && movedCount > 0) {
        const first = tests.find((t) => index.byHash.has(t.bodyHash) || refactoredInto(t, index))!;
        const dest = index.byHash.get(first.bodyHash)?.[0]?.path ?? refactoredInto(first, index)!;
        out.push(
          makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted; its ${tests.length} tests now live in ${dest}`, { label: 'moved' }),
        );
        continue;
      }
      const lost = tests.length - movedCount;
      out.push(
        makeFinding(ctx, 'R002', 'high', pair.file, pair.file.path, `Test file deleted with ${lost} test${lost === 1 ? '' : 's'} not found elsewhere`, {
          before: tests.map((t) => t.qualifiedName).join(', '),
        }),
      );
    }
    return out;
  },
};

/** R003 Test newly skipped or disabled. */
export const R003: Rule = {
  id: 'R003',
  name: 'Test newly skipped or disabled',
  group: 'R',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A skip, todo or fixme marker was added to a test that ran in the base.',
    falsePositives:
      'Conditional skips whose condition is not a constant (platform or optional dependency checks) are reported low. A reason that references an issue number or tracker URL lowers the severity one step.',
    example: '+  @pytest.mark.skip(reason="flaky in CI")\n   def test_batches(n):',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      if (isSkipped(base) || !isSkipped(head)) {
        // Conditional skip newly added: low.
        const condNew = head.markers.filter((m) => m.kind === 'conditional-skip' && !base.markers.some((b) => b.marker === m.marker));
        if (!isSkipped(base) && !isSkipped(head) && condNew.length) {
          const m = condNew[0]!;
          out.push(
            makeFinding(ctx, 'R003', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} gained a conditional skip (${m.marker})`, {
              label: 'conditional',
              line: m.line,
              after: m.marker,
              snippet: markersKey(head),
            }),
          );
        }
        continue;
      }
      const marker = head.markers.find((m) => (m.kind === 'skip' || m.kind === 'todo' || m.kind === 'fixme') && m.constant !== false)!;
      let sev: Severity = exercisesChangedProduction(pair.head, pair.file.path, ctx) ? 'high' : 'medium';
      let label: string | undefined;
      if (reasonReferencesIssue(marker.reason)) {
        sev = lower(sev);
        label = 'tracked';
      }
      out.push(
        makeFinding(ctx, 'R003', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} is now skipped (${marker.marker})${marker.reason ? `: ${marker.reason}` : ''}`, {
          line: marker.line,
          after: marker.marker + (marker.reason ? `(${marker.reason})` : ''),
          ...(label ? { label } : {}),
          snippet: markersKey(head),
        }),
      );
    }
    return out;
  },
};

/** R004 Test converted to expected failure. */
export const R004: Rule = {
  id: 'R004',
  name: 'Test converted to expected failure',
  group: 'R',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'An xfail, expectedFailure, test.fails or test.fail marker was added to a test that was expected to pass in the base.',
    falsePositives: 'A strict xfail with a reason that references an issue is lowered to medium: the failure is documented and will fail the suite once fixed.',
    example: '+  @pytest.mark.xfail(reason="see later")\n   def test_rounding():',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      if (isXfail(base) || !isXfail(head)) continue;
      const m = head.markers.find((x) => x.kind === 'xfail')!;
      const strict = /strict\s*=\s*True/.test(m.marker) || /strict/.test(m.marker);
      const sev: Severity = strict && reasonReferencesIssue(m.reason) ? 'medium' : 'high';
      out.push(
        makeFinding(ctx, 'R004', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} is now an expected failure (${m.marker})${m.reason ? `: ${m.reason}` : ''}`, {
          line: m.line,
          after: m.marker,
          snippet: markersKey(head),
        }),
      );
    }
    return out;
  },
};

/** R005 Focused test added. */
export const R005: Rule = {
  id: 'R005',
  name: 'Focused test added',
  group: 'R',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: ['typescript', 'javascript'],
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A .only, fit or fdescribe focus marker is present on a test in the head and was not there in the base. Every other test in the file is silently not run.',
    falsePositives: 'Almost none in a pull request. Vitest refuses .only in CI unless allowOnly is set; Jest and Playwright do not.',
    example: "-  it('rejects expired cards', async () => {\n+  it.only('rejects expired cards', async () => {",
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      let head: TestCase | undefined;
      let wasFocused = false;
      if (change.kind === 'added') head = change.head;
      else if (change.kind === 'modified' || change.kind === 'renamed') {
        head = change.head;
        wasFocused = isFocused(change.base);
      }
      if (!head || wasFocused || !isFocused(head)) continue;
      const m = head.markers.find((x) => x.kind === 'focus')!;
      out.push(
        makeFinding(ctx, 'R005', 'high', pair.file, head.qualifiedName, `Test ${head.qualifiedName} is focused (${m.marker}); other tests in this file will not run`, {
          line: m.line,
          after: m.marker,
          snippet: markersKey(head),
        }),
      );
    }
    return out;
  },
};

/** R006 Test body emptied. */
export const R006: Rule = {
  id: 'R006',
  name: 'Test body emptied or commented out',
  group: 'R',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A test that had executable statements in the base has none in the head (only pass, return, comments or a TODO). It will report as passing while testing nothing.',
    falsePositives: 'Java methods without a test annotation and Python functions the runner does not collect are not tests and are ignored by the front end.',
    example: '   def test_refund_updates_ledger(client):\n-      resp = client.post("/refund", json={"id": 7})\n-      assert resp.status_code == 200\n+      pass  # TODO restore after ledger refactor',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      if (base.statementCount === 0 || head.statementCount > 0) continue;
      if (isSkipped(head)) continue; // already reported by R003
      out.push(
        makeFinding(ctx, 'R006', 'high', pair.file, head.qualifiedName, `Test ${head.qualifiedName} had ${base.statementCount} statement${base.statementCount === 1 ? '' : 's'} and now has none`, {
          line: head.startLine,
          endLine: head.endLine,
          before: `${base.statementCount} statements, ${base.assertions.length} assertions`,
          after: 'empty body',
          snippet: head.bodyHash,
        }),
      );
    }
    return out;
  },
};

/** R010 Test added then skipped. */
export const R010: Rule = {
  id: 'R010',
  name: 'Test added then skipped',
  group: 'R',
  defaultSeverity: 'low',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A test new in this PR already carries a skip, todo, fixme or xfail marker. It is honest about not running but it is not coverage.',
    falsePositives: 'None by design: this is informational. It rises to medium when the PR text claims the test as coverage.',
    example: "+  test.fixme('handles 3DS challenge', async ({ page }) => {",
  },
  run(ctx) {
    const out: Finding[] = [];
    const claimsCoverage = ctx.prText ? /\b(add(ed|s)?|new|more)\s+(unit\s+|integration\s+)?tests?\b|\bcoverage\b/i.test(`${ctx.prText.title}\n${ctx.prText.body}`) : false;
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (!isSkipped(t) && !isXfail(t)) continue;
      const m = t.markers.find((x) => x.kind !== 'focus' && x.kind !== 'conditional-skip')!;
      out.push(
        makeFinding(ctx, 'R010', claimsCoverage ? 'medium' : 'low', pair.file, t.qualifiedName, `New test ${t.qualifiedName} is added with ${m.marker} and will not run`, {
          line: m.line,
          after: m.marker,
          snippet: markersKey(t),
        }),
      );
    }
    return out;
  },
};

export function rulesR(_ctx?: RuleContext): Rule[] {
  return [R001, R002, R003, R004, R005, R006, R010];
}
