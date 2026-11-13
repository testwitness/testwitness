import type { Finding, Rule, RuleContext, Severity, TestCase } from '../types.js';
import { allChanges, isFocused, isSkipped, isXfail, lower, reasonReferencesIssue, markersKey } from '../inventory.js';
import { stripChecklist, stripNonProse } from '../evidence/claims.js';
import { assertionKeyOf, exercisesChangedProduction, headIndex, makeFinding, movedByName, nearDuplicateOf, removedSubjectOf, subjectRemoved, versionGated, type HeadIndex } from './util.js';

const RULE_SINCE = '0.1.0';

/** The test's class or file existed before this PR (an override there converts an inherited test; in a new class it is an added test). */
function classExisted(pair: { file: { status: string }; base?: { tests: TestCase[] } }, t: TestCase): boolean {
  if (pair.file.status === 'added' || !pair.base) return false;
  if (t.container.length === 0) return true;
  if (pair.base.tests.some((b) => b.container.join('/') === t.container.join('/'))) return true;
  // The base file existed but had no tests of its own in that class (all inherited): still an existing class.
  return pair.base.tests.length === 0;
}

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
      'Renamed tests with the same body are not reported. Reported low with a label when the test was moved to another file (same body, same name added elsewhere in the PR, or same name in a file with the same name in another directory), folded into a parameterised test whose case count covers the removed tests, rewritten (other changed test files gained at least as many tests as the PR deleted), replaced (its class or group gained as many new tests as it lost) or refactored (every assertion survives in a changed file). Reported low with the label production removed when its production file was deleted, or when a class or function the test names was removed from a production file that stays (and is defined in no other changed file). Reported low with the label near duplicate removed when a test that stays in the same file or in another changed test file contains the deleted test token for token (whitespace, comments and the test names ignored, string literals compared without letter case, at most one literal differing only in case), is at most half as long again, and adds only checks (each run of added tokens holds expect, assert, should, verify or a toBe style matcher): the same setup and checks still run. A deleted test that differs in any identifier, number or literal value, whose copy adds input (another event, argument or field) rather than a check, or that is shorter than 25 tokens, is not a near duplicate. Reported low with the label version dropped when the test was gated on a language version (skipif on sys.version_info, process.versions, @EnabledOnJre) and the PR raises the minimum version (requires-python, python_requires, engines.node, the Java release). Precision over recall: a deletion is medium or high only when none of those signals is present.',
    example: '-  @Test\n-  void rejectsNegativeAmount() {\n-    assertThrows(IllegalArgumentException.class, () -> svc.charge(-1));\n-  }',
    history:
      'A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with one of the labels moved, parameterised, rewritten, replaced, refactored, production removed, version dropped or near duplicate removed are left alone, because the test still runs somewhere or only partly stopped running.',
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
      // Fold: parameterised tests in the same container gained enough cases to cover the deletions (sum across the container, literal counts), or one became parameterised with a dynamic source.
      const sameContainer = (pair.head?.tests ?? []).filter((h) => h.container.join('/') === t.container.join('/'));
      let gained = 0;
      let dynamicFold: TestCase | undefined;
      for (const h of sameContainer) {
        const b = pair.base?.tests.find((x) => x.qualifiedName === h.qualifiedName);
        const before = b?.parameterCount ?? (b ? 1 : 0);
        if (h.parameterCount !== undefined) gained += Math.max(0, h.parameterCount - before);
        else if (h.parameterised === true && !b?.parameterised) dynamicFold = h;
      }
      const fold = gained >= deletedInContainer && deletedInContainer > 0 ? sameContainer.find((h) => (h.parameterCount ?? 0) > 1) : dynamicFold;
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
      const sameClass = dests.length ? undefined : (await movedByName(ctx, pair.file.path, [t])).get(t.qualifiedName);
      if (sameClass) dests.push(sameClass);
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
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was removed while ${addedElsewhere} new test${addedElsewhere === 1 ? ' was' : 's were'} added in other changed test files; likely rewritten`, {
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
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was removed while ${addedInContainer} new test${addedInContainer === 1 ? ' was' : 's were'} added in the same ${t.container.length ? 'class or group' : 'file'}`, {
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
      // Checked last: a move, fold, rewrite or refactor describes the deletion better when one applies.
      const subject = await removedSubjectOf(ctx, pair.file.path, t);
      if (subject) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was deleted together with ${subject}, which this PR removed from the production code`, {
            label: 'production removed',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      if (await versionGated(ctx, pair.file.path, t)) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} only ran on a language version this PR stops supporting`, {
            label: 'version dropped',
            line: t.startLine,
            snippet: snippet(t),
          }),
        );
        continue;
      }
      // A redundant copy: a test that stays runs the same code and the same checks (perhaps a few more).
      const twin = await nearDuplicateOf(ctx, pair.file.path, t, pair.file.language);
      if (twin) {
        out.push(
          makeFinding(ctx, 'R001', 'low', pair.file, t.qualifiedName, `Test ${t.qualifiedName} was deleted; ${twin.test.qualifiedName}${twin.path === pair.file.path ? '' : ` in ${twin.path}`} still runs the same code and checks`, {
            label: 'near duplicate removed',
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
    falsePositives:
      'A file whose tests all reappear elsewhere in the head tree is reported low as moved: same bodies anywhere, or the same test names in a file with the same name in another directory (a class moved to another package with edits, which git sees as a deletion and an addition). Same names in a file with another name are not a move. A file deleted while new test files the PR adds in the same directory, or a new file with the same name elsewhere, hold at least as many tests as the deleted file is reported low as rewritten, a narrower form of the control R001 applies. Reported low with the label production removed when the production file was deleted too, or when every test names a class or function the PR removed from a production file that stays, and low with the label version dropped when every test was gated on a language version the PR stops supporting. Git rename detection handles pure moves before this rule runs.',
    example: 'deleted file mode 100644 src/__tests__/billing.test.ts',
  },
  async run(ctx) {
    const out: Finding[] = [];
    const added = new Map<string, number>();
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind === 'added') added.set(pair.file.path, (added.get(pair.file.path) ?? 0) + 1);
    }
    for (const pair of ctx.pairs) {
      if (pair.file.status !== 'deleted') continue;
      const tests = pair.base?.tests ?? [];
      if (tests.length === 0) continue;
      if (subjectRemoved(pair.base, pair.file.path, ctx)) {
        out.push(makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted together with the production code it exercised (${tests.length} tests)`, { label: 'production removed' }));
        continue;
      }
      const subjects = await Promise.all(tests.map((t) => removedSubjectOf(ctx, pair.file.path, t)));
      if (subjects.every((x) => x !== undefined)) {
        out.push(makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted together with ${[...new Set(subjects)].join(', ')}, which this PR removed from the production code (${tests.length} tests)`, { label: 'production removed' }));
        continue;
      }
      const gated = await Promise.all(tests.map((t) => versionGated(ctx, pair.file.path, t)));
      if (gated.every(Boolean)) {
        out.push(makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted whose ${tests.length} tests only ran on a language version this PR stops supporting`, { label: 'version dropped' }));
        continue;
      }
      const index = await headIndex(ctx, pair.file.path);
      const byName = await movedByName(ctx, pair.file.path, tests);
      const destOf = (t: TestCase): string | undefined => (t.statementCount > 0 ? (index.byHash.get(t.bodyHash)?.[0]?.path ?? refactoredInto(t, index)) : undefined) ?? byName.get(t.qualifiedName);
      const counted = tests.filter((t) => t.statementCount > 0 || byName.has(t.qualifiedName));
      const movedCount = counted.filter((t) => destOf(t) !== undefined).length;
      if (movedCount === counted.length && movedCount > 0) {
        const dest = destOf(counted[0]!)!;
        out.push(
          makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted; its ${tests.length} tests now live in ${dest}`, { label: 'moved' }),
        );
        continue;
      }
      // Rewritten: new test files this PR adds next to the deleted one hold at least as many tests as the PR deleted
      // (R001's control, narrowed to new files in the same directory: tests added to an existing file about another
      // subject are not a rewrite of this one).
      // A new file with the same name in another directory is the class re-homed and rewritten (tests renamed).
      const dir = pair.file.path.slice(0, pair.file.path.lastIndexOf('/') + 1);
      const fileName = pair.file.path.slice(dir.length);
      const nearby = (p: (typeof ctx.pairs)[number]): boolean => p.file.path.slice(0, p.file.path.lastIndexOf('/') + 1) === dir || p.file.path.endsWith(`/${fileName}`);
      const addedElsewhere = ctx.pairs.filter((p) => p.file.status === 'added' && nearby(p)).reduce((n, p) => n + (added.get(p.file.path) ?? 0), 0);
      if (addedElsewhere >= tests.length && addedElsewhere > 0) {
        out.push(
          makeFinding(ctx, 'R002', 'low', pair.file, pair.file.path, `Test file deleted with ${tests.length} test${tests.length === 1 ? '' : 's'} while ${addedElsewhere} new test${addedElsewhere === 1 ? ' was' : 's were'} added in other changed test files; likely rewritten`, { label: 'rewritten' }),
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
    history:
      'A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with the label conditional are left alone, because the test still runs somewhere or only partly stopped running. A skip whose reason references an issue (label tracked) on a test the history records as flaky (it passed and failed within the last 20 runs, or reran in at least 2 of them) keeps its severity and gets the label flaky in history, and the message states the counts. A skip of a flaky test without an issue reference is unchanged.',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      // A test deleted and re added under the same name with a skip (moved within the file, or into another describe) is a new skip.
      if (change.kind === 'added' && isSkipped(change.head)) {
        const deleted = allChanges([pair]).find((c) => c.change.kind === 'deleted' && c.change.base.name === change.head.name && !isSkipped(c.change.base));
        // An override whose body only calls the inherited test exists to disable that test, when the class already existed.
        if (!deleted && !(change.head.overrideOnly && classExisted(pair, change.head))) continue;
        const head = change.head;
        const marker = head.markers.find((m) => ((m.kind === 'skip' || m.kind === 'todo' || m.kind === 'fixme') && m.constant !== false) || (m.kind === 'conditional-skip' && m.constant === true))!;
        let sev: Severity = exercisesChangedProduction(pair.head, pair.file.path, ctx) ? 'high' : 'medium';
        let label: string | undefined;
        if (reasonReferencesIssue(marker.reason)) {
          sev = lower(sev);
          label = 'tracked';
        }
        if (!deleted) label = label ?? 'override';
        out.push(
          makeFinding(ctx, 'R003', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} is now skipped (${marker.marker})${marker.reason ? `: ${marker.reason}` : ''}${deleted ? '' : '; the override only disables the inherited test'}`, {
            line: marker.line,
            after: marker.marker + (marker.reason ? `(${marker.reason})` : ''),
            ...(label ? { label } : {}),
            snippet: markersKey(head),
          }),
        );
        continue;
      }
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      if (isSkipped(base) || !isSkipped(head)) {
        // Conditional skip newly added: low.
        const condNew = head.markers.filter((m) => m.kind === 'conditional-skip' && m.constant !== true && !base.markers.some((b) => b.marker === m.marker));
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
      const marker = head.markers.find((m) => ((m.kind === 'skip' || m.kind === 'todo' || m.kind === 'fixme') && m.constant !== false) || (m.kind === 'conditional-skip' && m.constant === true))!;
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
    history:
      'A finding on a test that failed or errored in at least 2 of its last 5 recorded runs becomes high with the label hides failure, and the message states the count (failed in 3 of the last 5 runs). Findings the rule already graded low with the label conditional or one case are left alone, because the test still runs somewhere or only partly stopped running.',
  },
  run(ctx) {
    const out: Finding[] = [];
    const report = (pair: (typeof ctx.pairs)[number], head: TestCase, base: TestCase | undefined, suffix = '') => {
      const m = head.markers.find((x) => x.kind === 'xfail')!;
      const strict = /strict/.test(m.marker);
      const perCase = m.marker.startsWith('pytest.param');
      let sev: Severity = strict && reasonReferencesIssue(m.reason) ? 'medium' : 'high';
      let label: string | undefined;
      if (m.constant === false) {
        sev = 'low';
        label = 'conditional';
      } else if (perCase) {
        sev = sev === 'high' ? 'medium' : 'low';
        label = 'one case';
      } else if (!base) {
        label = 'override';
      }
      out.push(
        makeFinding(ctx, 'R004', sev, pair.file, head.qualifiedName, `Test ${head.qualifiedName} is now an expected failure (${m.marker})${m.reason ? `: ${m.reason}` : ''}${suffix}`, {
          line: m.line,
          after: m.marker,
          ...(label ? { label } : {}),
          snippet: markersKey(head),
        }),
      );
    };
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind === 'added') {
        const t = change.head;
        if (t.overrideOnly && classExisted(pair, t) && t.markers.some((x) => x.kind === 'xfail')) report(pair, t, undefined, '; the override only marks the inherited test');
        continue;
      }
      if (change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const { base, head } = change;
      const baseX = base.markers.some((x) => x.kind === 'xfail');
      const headX = head.markers.some((x) => x.kind === 'xfail');
      if (baseX || !headX) continue;
      report(pair, head, base);
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
    falsePositives: 'Informational by design. It rises to medium when the PR text claims the test as coverage; a ticked checklist box from a PR template is not such a claim. Classes under src/main are never run as tests by Maven or Gradle and are not reported (skipping samples that other tests use as input).',
    example: "+  test.fixme('handles 3DS challenge', async ({ page }) => {",
  },
  run(ctx) {
    const out: Finding[] = [];
    // Checked template boxes ("- [x] Add test case(s)") tick a reminder; they do not claim the new test as coverage.
    const claimsCoverage = ctx.prText ? /\b(add(ed|s)?|new|more)\s+(unit\s+|integration\s+)?tests?\b|\bcoverage\b/i.test(stripChecklist(stripNonProse(`${ctx.prText.title}\n${ctx.prText.body}`))) : false;
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      // Maven and Gradle never run classes under src/main as tests: a skipping sample there is input for another test.
      if (/(^|\/)src\/main\//.test(pair.file.path)) continue;
      const t = change.head;
      if (!isSkipped(t) && !isXfail(t)) continue;
      if (allChanges([pair]).some((c) => c.change.kind === 'deleted' && c.change.base.name === t.name)) continue; // reported by R003
      // An override in a class that existed is reported by R003 or R004; in a new class it is a test added then skipped.
      if (t.overrideOnly && classExisted(pair, t)) continue;

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
