import type { ChangedFile, FileMutation, Finding, InventoryPair, LanguageId, MutationEvidence, Rule, RuleContext, Severity, TestCase } from '../types.js';
import { allChanges, isSkipped, isXfail } from '../inventory.js';
import { inventoryKeys } from '../evidence/normalise.js';
import { makeFinding, stem } from './util.js';
import { templateRegex } from './V.js';

const RULE_SINCE = '0.1.0';

/** Changed production files M001 looks at, at most. */
export const M001_MAX_FILES = 200;

function langOf(pair: InventoryPair): LanguageId {
  return (pair.file.language ?? 'typescript') as LanguageId;
}

/** Normalised keys of a test, as the JUnit reader and the mutation readers build them. */
export function testKeys(pair: InventoryPair, t: TestCase): string[] {
  return inventoryKeys(pair.file.path, t.qualifiedName, langOf(pair));
}

/** Does any key (or, for a test.each title, any formatted row of it) appear in the set? */
function inSet(keys: string[], set: ReadonlySet<string>, qualifiedName: string): boolean {
  if (keys.some((k) => set.has(k))) return true;
  if (/%[sdifjop#]|\$\w+/.test(qualifiedName)) {
    const res = keys.map(templateRegex);
    for (const k of set) if (res.some((re) => re.test(k))) return true;
  }
  return false;
}

function productionFiles(ctx: RuleContext): ChangedFile[] {
  return ctx.files.filter((f) => f.kind === 'production' && f.status !== 'deleted' && !f.binary);
}

/** Mutated lines among the lines this PR added or changed, and the subset where no mutant was killed. */
export function changedLineMutation(f: ChangedFile, fm: FileMutation): { mutated: number[]; weak: number[]; survived: number; noCoverage: number } {
  const mutated: number[] = [];
  const weak: number[] = [];
  let survived = 0;
  let noCoverage = 0;
  for (const line of [...f.addedLines].sort((a, b) => a - b)) {
    const l = fm.lines.get(line);
    if (!l || l.total === 0) continue;
    mutated.push(line);
    if (l.killed === 0) {
      weak.push(line);
      survived += l.survived;
      noCoverage += l.noCoverage;
    }
  }
  return { mutated, weak, survived, noCoverage };
}

/**
 * Changed production files with mutants on their changed lines that a test exercises. When the report records which
 * tests covered a file's mutants (Stryker coveredBy, PIT succeedingTests), that decides; otherwise the name convention
 * and the imports of the test file do, as for the other rules.
 */
export function exercisedFiles(ctx: RuleContext, mut: MutationEvidence, pair: InventoryPair, t: TestCase): Array<{ file: ChangedFile; fm: FileMutation }> {
  const keys = testKeys(pair, t);
  const own = stem(pair.file.path).toLowerCase();
  const refs = new Set<string>();
  for (const imp of pair.head?.imports ?? []) for (const part of imp.split(/[./\\:]/).filter(Boolean)) refs.add(part.toLowerCase());
  const out: Array<{ file: ChangedFile; fm: FileMutation }> = [];
  for (const f of productionFiles(ctx)) {
    const fm = mut.lookup(f.path);
    if (!fm) continue;
    let anyCoverage = false;
    let covered = false;
    for (const l of fm.lines.values()) {
      if (l.coveredBy.size) anyCoverage = true;
      if (inSet(keys, l.coveredBy, t.qualifiedName)) {
        covered = true;
        break;
      }
    }
    const s = stem(f.path).toLowerCase();
    const byName = !!s && (own === s || refs.has(s));
    if (covered || (!anyCoverage && byName)) out.push({ file: f, fm });
  }
  return out;
}

/**
 * What the mutation reports say about the oracle of a new test, for O001 and O002:
 *   strong  the test itself killed a mutant on a changed line of a production file it exercises;
 *   weak    the production files it exercises have mutants on their changed lines and none of them was killed;
 *   undefined otherwise (no data, no exercised file with mutants on changed lines, or killed by other tests only).
 */
export function mutationOracle(ctx: RuleContext, pair: InventoryPair, t: TestCase): 'strong' | 'weak' | undefined {
  const mut = ctx.mutation;
  if (!mut) return undefined;
  const keys = testKeys(pair, t);
  let mutated = 0;
  let killed = 0;
  for (const { file, fm } of exercisedFiles(ctx, mut, pair, t)) {
    for (const line of file.addedLines) {
      const l = fm.lines.get(line);
      if (!l || l.total === 0) continue;
      if (mut.testIds && inSet(keys, l.killedBy, t.qualifiedName)) return 'strong';
      mutated += l.total;
      killed += l.killed;
    }
  }
  if (mutated > 0 && killed === 0) return 'weak';
  return undefined;
}

/** M001 Changed lines with surviving mutants. */
export const M001: Rule = {
  id: 'M001',
  name: 'Changed lines with surviving mutants',
  group: 'M',
  defaultSeverity: 'medium',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'mutation'],
  docs: {
    summary:
      'Mutation reports of the head (Stryker JSON or PIT mutations.xml, from the opt in mutation job; the mutation input, --mutation or mutation.paths) say that lines this PR added or changed in a production file carry mutants that no test killed: every mutant starting on the line survived or was not covered. One finding per file with the count and the first three line numbers, label measured weak. Medium when at least 3 such lines, or more than half of the mutated changed lines, are weak; low otherwise. Nothing is reported without mutation reports.',
    falsePositives:
      'Only lines with at least one mutant that ran to an outcome count; compile errors, runtime errors, ignored and pending mutants are not counted, and a timed out mutant counts as killed. A mutant is attributed to the line it starts on, so a removed block is counted on the line of its opening brace. Equivalent mutants (a change no test could observe, such as >= against > on a value the code never reaches) survive by nature; one weak line in a well tested file stays low. Reports from a run that mutated other files than the PR changed say nothing about the changed lines and give no finding. At most 200 changed production files are checked and at most 200 report files or 50 MB are read.',
    example: 'src/shipping.ts: 4 changed lines have mutants that no test killed (lines 3, 4, 6 and 1 more): 6 survived, 6 not covered.',
  },
  run(ctx) {
    const mut = ctx.mutation;
    if (!mut) return [];
    const out: Finding[] = [];
    for (const f of productionFiles(ctx).slice(0, M001_MAX_FILES)) {
      const fm = mut.lookup(f.path);
      if (!fm) continue;
      const { mutated, weak, survived, noCoverage } = changedLineMutation(f, fm);
      if (!weak.length) continue;
      const sev: Severity = weak.length >= 3 || weak.length * 2 > mutated.length ? 'medium' : 'low';
      const first = weak.slice(0, 3).join(', ');
      const more = weak.length > 3 ? ` and ${weak.length - 3} more` : '';
      const parts = [survived ? `${survived} survived` : '', noCoverage ? `${noCoverage} not covered` : ''].filter(Boolean).join(', ');
      out.push(
        makeFinding(ctx, 'M001', sev, f, f.path, `${weak.length} changed line${weak.length === 1 ? '' : 's'} in ${f.path} ${weak.length === 1 ? 'has' : 'have'} mutants that no test killed (line${weak.length === 1 ? '' : 's'} ${first}${more}): ${parts}`, {
          line: weak[0]!,
          label: 'measured weak',
          snippet: 'mutants-survived',
        }),
      );
    }
    return out;
  },
};

/** M002 New test kills nothing. */
export const M002: Rule = {
  id: 'M002',
  name: 'New test kills nothing',
  group: 'M',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'ast', 'mutation'],
  docs: {
    summary:
      'A test added in this PR appears in no killing test list of the mutation reports, although the reports name the tests that killed mutants (Stryker killedBy with testFiles, PIT killingTest or killingTests). The test ran under mutation and noticed none of the changes. High when the test exercises a changed production file with mutants (by the coverage the report records, or by name and imports when it records none); medium otherwise. Label measured weak.',
    falsePositives:
      'Silent when the reports name no killing tests, with a note in the mutation section of the report. When a Stryker report lists the tests of the run (testFiles), a new test it does not list did not run under mutation and gets no finding. A test that only checks that nothing throws can still kill a mutant that throws; that counts as a kill. PIT stops at the first killing test of a mutant unless fullMutationMatrix is on, so a test whose every kill was also made by an earlier test can look like it kills nothing; turn fullMutationMatrix on in the mutation job to rule that out. Skipped and expected failure tests are not reported.',
    example: "+it('returns text for euros', () => {\n+  expect(typeof money(5, '€')).toBe('string');\n+});",
  },
  run(ctx) {
    const mut = ctx.mutation;
    if (!mut || !mut.testIds) return [];
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added') continue;
      const t = change.head;
      if (isSkipped(t) || isXfail(t)) continue;
      const keys = testKeys(pair, t);
      if (mut.tests && !inSet(keys, mut.tests, t.qualifiedName)) continue; // not part of the mutation run
      if (inSet(keys, mut.killers, t.qualifiedName)) continue;
      const exercised = exercisedFiles(ctx, mut, pair, t).filter(({ file, fm }) => changedLineMutation(file, fm).mutated.length > 0);
      const sev: Severity = exercised.length ? 'high' : 'medium';
      const where = exercised.length ? `, including the changed lines of ${exercised.map((e) => e.file.path).slice(0, 2).join(' and ')}` : '';
      out.push(
        makeFinding(ctx, 'M002', sev, pair.file, t.qualifiedName, `New test ${t.qualifiedName} killed none of the ${mut.mutants} mutants in the mutation reports${where}`, {
          line: t.startLine,
          endLine: t.endLine,
          label: 'measured weak',
          snippet: 'kills-nothing',
        }),
      );
    }
    return out;
  },
};

export function rulesM(): Rule[] {
  return [M001, M002];
}
