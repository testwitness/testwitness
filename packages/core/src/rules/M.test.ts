import { describe, expect, it } from 'vitest';
import type { ChangedFile, LineMutation, MutationEvidence } from '../types.js';
import { M001, M001_MAX_FILES, M002, mutationOracle } from './M.js';
import { O001, O002 } from './O.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

type LineSpec = Partial<Omit<LineMutation, 'killedBy' | 'coveredBy'>> & { killedBy?: string[]; coveredBy?: string[] };

/** Mutation evidence from per file, per line specs. A line's total defaults to killed + survived + noCoverage. */
function mutation(files: Record<string, Record<number, LineSpec>>, extra: { testIds?: boolean; tests?: string[] } = {}): MutationEvidence {
  const map = new Map<string, Map<number, LineMutation>>();
  const killers = new Set<string>();
  let mutants = 0;
  for (const [path, lines] of Object.entries(files)) {
    const m = new Map<number, LineMutation>();
    for (const [line, s] of Object.entries(lines)) {
      const killed = s.killed ?? 0;
      const survived = s.survived ?? 0;
      const noCoverage = s.noCoverage ?? 0;
      const total = s.total ?? killed + survived + noCoverage;
      mutants += total;
      for (const k of s.killedBy ?? []) killers.add(k);
      m.set(Number(line), { total, killed, survived, noCoverage, killedBy: new Set(s.killedBy ?? []), coveredBy: new Set(s.coveredBy ?? []) });
    }
    map.set(path, m);
  }
  return {
    sources: ['mutation.json'],
    tools: ['stryker'],
    files: map.size,
    mutants,
    killed: 0,
    survived: 0,
    noCoverage: 0,
    testIds: extra.testIds ?? true,
    ...(extra.tests ? { tests: new Set(extra.tests) } : {}),
    killers,
    warnings: [],
    lookup: (p) => (map.has(p) ? { lines: map.get(p)! } : undefined),
  };
}

function prod(path: string, lines: number[], status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { ...changedFile(path, status), kind: 'production', addedLines: new Set(lines) };
}

const TEST = 'src/tax.test.ts';
/** A test file that adds one test without an assertion (or with the given assertions). */
function addedTest(name: string, assertions: Array<{ callee: string; kind?: 'value' | 'smoke' }> = [], path = TEST) {
  const head = t({ name, body: `${name} body`, assertions });
  return { file: changedFile(path, 'modified'), base: inventory(path, []), head: inventory(path, [head]) };
}

describe('M001 changed lines with surviving mutants', () => {
  it('is medium with three weak lines and lists the first three', async () => {
    const f = prod('src/tax.ts', [3, 4, 5, 6, 7]);
    const mut = mutation({ 'src/tax.ts': { 3: { survived: 2 }, 4: { noCoverage: 1 }, 5: { survived: 1, noCoverage: 1 }, 6: { killed: 1 }, 7: { survived: 1 } } });
    const out = await M001.run(context({ pairs: [], files: [f], mutation: mut }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'M001', severity: 'medium', label: 'measured weak', subject: 'src/tax.ts', location: { path: 'src/tax.ts', line: 3 } });
    expect(out[0]!.message).toBe('4 changed lines in src/tax.ts have mutants that no test killed (lines 3, 4, 5 and 1 more): 4 survived, 2 not covered');
  });

  it('is medium when more than half of the mutated changed lines are weak, and low otherwise', async () => {
    const f = prod('src/a.ts', [1, 2, 3, 4]);
    const half = await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/a.ts': { 1: { survived: 1 }, 2: { killed: 1 } } }) }), {});
    expect(half[0]).toMatchObject({ severity: 'low' }); // 1 of 2 is not more than half
    const most = await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/a.ts': { 1: { survived: 1 }, 2: { survived: 1 }, 3: { killed: 1 } } }) }), {});
    expect(most[0]).toMatchObject({ severity: 'medium' });
    const few = await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/a.ts': { 1: { survived: 1 }, 2: { killed: 2 }, 3: { killed: 1 }, 4: { killed: 1, survived: 3 } } }) }), {});
    expect(few[0]).toMatchObject({ severity: 'low' });
    expect(few[0]!.message).toBe('1 changed line in src/a.ts has mutants that no test killed (line 1): 1 survived');
  });

  it('is silent when every mutated changed line had a kill, when lines are unchanged, and without data', async () => {
    const f = prod('src/a.ts', [1, 2]);
    expect(await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/a.ts': { 1: { killed: 1, survived: 4 }, 2: { killed: 1 }, 9: { survived: 5 } } }) }), {})).toEqual([]);
    expect(await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/a.ts': { 1: { total: 0 } } }) }), {})).toEqual([]);
    expect(await M001.run(context({ pairs: [], files: [f] }), {})).toEqual([]);
    expect(await M001.run(context({ pairs: [], files: [f], mutation: mutation({ 'src/other.ts': { 1: { survived: 1 } } }) }), {})).toEqual([]);
  });

  it('ignores deleted, binary and test files, and stops at the file cap', async () => {
    const spec = { 1: { survived: 1 } };
    const files = [prod('src/gone.ts', [1], 'deleted'), { ...prod('src/bin.ts', [1]), binary: true }, { ...prod('src/x.test.ts', [1]), kind: 'test' as const }];
    expect(await M001.run(context({ pairs: [], files, mutation: mutation({ 'src/gone.ts': spec, 'src/bin.ts': spec, 'src/x.test.ts': spec }) }), {})).toEqual([]);
    const many = Array.from({ length: M001_MAX_FILES + 5 }, (_, i) => prod(`src/f${i}.ts`, [1]));
    const out = await M001.run(context({ pairs: [], files: many, mutation: mutation(Object.fromEntries(many.map((f) => [f.path, spec]))) }), {});
    expect(out).toHaveLength(M001_MAX_FILES);
  });
});

describe('M002 new test kills nothing', () => {
  const taxFile = prod('src/tax.ts', [5, 6]);
  const KEY = 'tax::handles an exemption';

  it('is high when the new test covers a changed production file with mutants and killed none of them', async () => {
    const mut = mutation({ 'src/tax.ts': { 6: { survived: 4, coveredBy: [KEY] }, 2: { killed: 1, killedBy: ['tax::charges'] } } }, { tests: [KEY, 'tax::charges'] });
    const out = await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: mut }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'M002', severity: 'high', label: 'measured weak', subject: 'handles an exemption' });
    expect(out[0]!.message).toContain('including the changed lines of src/tax.ts');
  });

  it('maps the test to production files by name when the report records no coverage', async () => {
    const mut = mutation({ 'src/tax.ts': { 6: { survived: 1 } }, 'src/other.ts': { 1: { killed: 1, killedBy: ['other::x'] } } });
    const out = await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: mut }), {});
    expect(out[0]).toMatchObject({ severity: 'high' });
  });

  it('is medium when the test exercises no changed production file with mutants', async () => {
    const mut = mutation({ 'src/other.ts': { 1: { killed: 1, killedBy: ['other::x'] } } });
    const out = await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [prod('src/other.ts', [1])], mutation: mut }), {});
    expect(out[0]).toMatchObject({ severity: 'medium' });
    expect(out[0]!.message).not.toContain('including');
  });

  it('is silent when the test killed a mutant anywhere, when the report names no tests, or lists tests without it', async () => {
    const killed = mutation({ 'src/tax.ts': { 9: { killed: 1, killedBy: [KEY] }, 6: { survived: 1 } } });
    expect(await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: killed }), {})).toEqual([]);
    const noIds = mutation({ 'src/tax.ts': { 6: { survived: 1 } } }, { testIds: false });
    expect(await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: noIds }), {})).toEqual([]);
    const notRun = mutation({ 'src/tax.ts': { 6: { survived: 1 } } }, { tests: ['tax::charges'] });
    expect(await M002.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: notRun }), {})).toEqual([]);
  });

  it('matches formatted rows of a test.each title, and skips skipped and modified tests', async () => {
    const each = { file: changedFile(TEST), base: inventory(TEST, []), head: inventory(TEST, [t({ name: 'adds %i', body: 'x' })]) };
    const mut = mutation({ 'src/tax.ts': { 6: { killed: 1, killedBy: ['tax::adds 3'] } } });
    expect(await M002.run(context({ pairs: [each], files: [taxFile], mutation: mut }), {})).toEqual([]);
    const skipped = { file: changedFile(TEST), base: inventory(TEST, []), head: inventory(TEST, [t({ name: 'later', body: 'x', markers: [{ marker: 'it.skip', kind: 'skip', constant: true }] })]) };
    const modified = { file: changedFile(TEST), base: inventory(TEST, [t({ name: 'old', body: 'a' })]), head: inventory(TEST, [t({ name: 'old', body: 'b' })]) };
    const none = mutation({ 'src/tax.ts': { 6: { survived: 1 } } });
    expect(await M002.run(context({ pairs: [skipped, modified], files: [taxFile], mutation: none }), {})).toEqual([]);
  });

  it('keys Java and Python tests like the JUnit reader', async () => {
    const jPath = 'src/test/java/demo/TaxTest.java';
    const j = { file: changedFile(jPath, 'modified', 'java'), base: inventory(jPath, [], { language: 'java' }), head: inventory(jPath, [{ ...t({ name: 'exempts', body: 'x' }), qualifiedName: 'TaxTest#exempts' }], { language: 'java' }) };
    const mut = mutation({ 'src/main/java/demo/Tax.java': { 9: { killed: 1, killedBy: ['taxtest::exempts'] } } });
    expect(await M002.run(context({ pairs: [j], files: [prod('src/main/java/demo/Tax.java', [9])], mutation: mut }), {})).toEqual([]);
  });
});

describe('O001 and O002 measured by mutation', () => {
  const taxFile = prod('src/tax.ts', [5, 6]);
  const KEY = 'tax::handles an exemption';

  it('raises O001 to medium measured weak when no mutant on the changed lines the test covers was killed', async () => {
    const mut = mutation({ 'src/tax.ts': { 5: { survived: 1, coveredBy: [KEY] }, 6: { survived: 4, coveredBy: [KEY] } } });
    const out = await O001.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: mut }), {});
    expect(out[0]).toMatchObject({ severity: 'medium', label: 'measured weak' });
  });

  it('drops O001 when the test itself killed a mutant on a changed line', async () => {
    const mut = mutation({ 'src/tax.ts': { 5: { killed: 1, killedBy: [KEY], coveredBy: [KEY] }, 6: { survived: 4, coveredBy: [KEY] } } });
    expect(await O001.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: mut }), {})).toEqual([]);
  });

  it('keeps O001 low when other tests killed the mutants, when nothing on the changed lines was mutated, or without data', async () => {
    const byOthers = mutation({ 'src/tax.ts': { 5: { killed: 1, killedBy: ['tax::other'], coveredBy: [KEY, 'tax::other'] } } });
    const unmutated = mutation({ 'src/tax.ts': { 9: { survived: 1, coveredBy: [KEY] } } });
    for (const m of [byOthers, unmutated, undefined]) {
      const out = await O001.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], ...(m ? { mutation: m } : {}) }), {});
      expect(out[0]).toMatchObject({ severity: 'low' });
      expect(out[0]!.label).toBeUndefined();
    }
  });

  it('does not count a kill by the test when the report names no killing tests', async () => {
    const mut = mutation({ 'src/tax.ts': { 5: { killed: 1, killedBy: [KEY] } } }, { testIds: false });
    const out = await O001.run(context({ pairs: [addedTest('handles an exemption')], files: [taxFile], mutation: mut }), {});
    expect(out[0]).toMatchObject({ severity: 'low' });
  });

  it('uses the coverage the report records over the file name: a test that covers nothing in tax.ts is not measured by it', async () => {
    const mut = mutation({ 'src/tax.ts': { 5: { survived: 1, coveredBy: ['tax::other'] } } });
    const pair = addedTest('handles an exemption');
    const ctx = context({ pairs: [pair], files: [taxFile], mutation: mut });
    expect(mutationOracle(ctx, pair, pair.head.tests[0]!)).toBeUndefined();
  });

  it('raises O002 to medium measured weak and drops it when the test killed a mutant on a changed line', async () => {
    const smoke = [{ callee: 'expect(x).toBeDefined', kind: 'smoke' as const }];
    const weak = mutation({ 'src/tax.ts': { 5: { survived: 2, coveredBy: [KEY] } } });
    const out = await O002.run(context({ pairs: [addedTest('handles an exemption', smoke)], files: [taxFile], mutation: weak }), {});
    expect(out[0]).toMatchObject({ severity: 'medium', label: 'measured weak' });
    const strong = mutation({ 'src/tax.ts': { 5: { killed: 1, killedBy: [KEY], coveredBy: [KEY] } } });
    expect(await O002.run(context({ pairs: [addedTest('handles an exemption', smoke)], files: [taxFile], mutation: strong }), {})).toEqual([]);
    const none = await O002.run(context({ pairs: [addedTest('handles an exemption', smoke)], files: [taxFile] }), {});
    expect(none[0]).toMatchObject({ severity: 'low', label: 'smoke' });
  });
});
