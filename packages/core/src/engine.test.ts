import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tsFrontEnd } from '../../lang-ts/src/index.js';
import { computeState, exitCodeFor, runEngine, REPORT_SCHEMA, REPORT_SCHEMA_VERSION, TOOL_VERSION } from './engine.js';
import type { EngineOptions } from './engine.js';
import { defaultConfig } from './config.js';
import type { ChangedFile, Evidence, Finding, Report, ResolvedConfig, Rule } from './types.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

const BASE_TEST = `import { describe, it, expect } from 'vitest';
import { add, sub, mul } from './calc';

describe('calc', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
  it('subtracts', () => {
    expect(sub(3, 1)).toBe(2);
  });
  it('multiplies', () => {
    expect(mul(2, 3)).toBe(6);
  });
});
`;

const HEAD_TEST = `import { describe, it, expect } from 'vitest';
import { add, mul, div } from './calc';

describe('calc', () => {
  it.skip('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
  it('multiplies', () => {
    expect(mul(2, 3)).toBe(6);
  });
});

describe('division', () => {
  it('divides', () => {
    div(6, 3);
  });
});
`;

const BASE_PROD = 'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\nexport const mul = (a: number, b: number) => a * b;\n';
const HEAD_PROD = 'export const add = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\nexport const div = (a: number, b: number) => a / b;\n';

let dir: string;
let base: string;
let head: string;

function sh(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });
}
function put(path: string, content: string): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-engine-'));
  sh('init', '-q', '-b', 'main');
  sh('config', 'commit.gpgsign', 'false');
  put('src/calc.ts', BASE_PROD);
  put('src/calc.test.ts', BASE_TEST);
  put('vendor/dist/ignored.test.ts', BASE_TEST);
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  base = sh('rev-parse', 'HEAD').trim();
  put('src/calc.ts', HEAD_PROD);
  put('src/calc.test.ts', HEAD_TEST);
  put('vendor/dist/ignored.test.ts', HEAD_TEST);
  sh('add', '-A');
  sh('commit', '-q', '-m', 'head\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
  head = sh('rev-parse', 'HEAD').trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cfg(patch: Partial<ResolvedConfig> = {}): ResolvedConfig {
  const c = defaultConfig();
  c.paths = { tests: [], ignore: [...c.paths.ignore, '**/vendor/**'] };
  return { ...c, ...patch };
}
function opts(over: Partial<EngineOptions> = {}): EngineOptions {
  return { cwd: dir, base, head, frontEnds: [tsFrontEnd], config: cfg(), ...over };
}

function evidence(): Evidence {
  return { sources: ['junit.xml'], total: 1, passed: 1, failed: 0, errored: 0, skipped: 0, flaky: 0, has: () => true, statusOf: () => 'passed', keysForClass: () => [], keys: () => [] };
}

function stubRule(id: string, severity: Finding['severity'], run?: Rule['run']): Rule {
  return {
    id,
    name: id,
    group: 'X',
    defaultSeverity: severity,
    since: '0.1.0',
    languages: 'any',
    needs: ['diff'],
    docs: { summary: '', falsePositives: '', example: '' },
    run:
      run ??
      (() => [
        { ruleId: id, severity, message: `${id} message`, location: { path: 'src/calc.test.ts', line: 1 }, fingerprint: `${id}:fp` },
      ]),
  };
}

function fakeFile(kind: ChangedFile['kind']): ChangedFile {
  return { status: 'modified', path: 'x', kind, hunks: [], binary: false, addedLines: new Set(), removedLines: new Set() };
}
function fakeFinding(severity: Finding['severity'], extra: Partial<Finding> = {}): Finding {
  return { ruleId: 'R001', severity, message: 'm', location: { path: 'p' }, fingerprint: `fp-${severity}`, ...extra };
}

describe('runEngine', () => {
  it('produces a review report for weakened tests', async () => {
    const { report } = await runEngine(opts());
    expect(report.state).toBe('review');
    expect(report.$schema).toBe(REPORT_SCHEMA);
    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.tool).toEqual({ name: 'testwitness', version: TOOL_VERSION });
    expect(report.mode).toBe('report');
    expect(report.base).toBe(base);
    expect(report.head).toBe(head);
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids).toContain('R001');
    expect(ids).toContain('R003');
  });

  it('counts files by kind and ignores configured paths', async () => {
    const { report, files } = await runEngine(opts());
    expect(report.files).toEqual({ changed: 3, tests: 1, production: 1, config: 0, workflows: 0, snapshots: 0 });
    expect(files.map((f) => f.path).sort()).toEqual(['src/calc.test.ts', 'src/calc.ts', 'vendor/dist/ignored.test.ts']);
  });

  it('paths.ignore excludes a file from inventories', async () => {
    const { pairs } = await runEngine(opts());
    expect(pairs.map((p) => p.file.path)).toEqual(['src/calc.test.ts']);
    const { pairs: all } = await runEngine(opts({ config: { ...cfg(), paths: { tests: [], ignore: [] } } }));
    expect(all.map((p) => p.file.path).sort()).toEqual(['src/calc.test.ts', 'vendor/dist/ignored.test.ts']);
  });

  it('builds base and head inventories for the changed test file', async () => {
    const { pairs } = await runEngine(opts());
    const pair = pairs[0]!;
    expect(pair.base!.tests.map((t) => t.name)).toEqual(['adds', 'subtracts', 'multiplies']);
    expect(pair.head!.tests.map((t) => t.name)).toEqual(['adds', 'multiplies', 'divides']);
  });

  it('summary counts match the findings', async () => {
    const { report } = await runEngine(opts());
    const open = report.findings.filter((f) => !f.acknowledged);
    expect(report.summary.findings).toEqual({
      high: open.filter((f) => f.severity === 'high').length,
      medium: open.filter((f) => f.severity === 'medium').length,
      low: open.filter((f) => f.severity === 'low').length,
    });
    const nonLow = (pred: (id: string) => boolean) => report.findings.filter((f) => pred(f.ruleId) && f.severity !== 'low').length;
    expect(report.summary.testsDeleted).toBe(nonLow((id) => id === 'R001' || id === 'R002'));
    expect(report.summary.testsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.summary.testsSkipped).toBe(nonLow((id) => id === 'R003' || id === 'R004'));
    expect(report.summary.testsSkipped).toBeGreaterThanOrEqual(1);
    expect(report.summary.assertionsWeakened).toBe(nonLow((id) => id.startsWith('A')));
    expect(report.summary.changedTestsNotRun).toBe(0);
  });

  it('sorts findings high first, then by rule id, then by path', async () => {
    const rules = [
      stubRule('X003', 'low'),
      stubRule('X001', 'high'),
      stubRule('X002', 'medium'),
      stubRule('X000', 'high'),
    ];
    const { report } = await runEngine(opts({ rules }));
    expect(report.findings.map((f) => f.ruleId)).toEqual(['X000', 'X001', 'X002', 'X003']);
    expect(report.findings.map((f) => f.severity)).toEqual(['high', 'high', 'medium', 'low']);
  });

  it('breaks severity and rule ties by path', async () => {
    const at = (path: string): Rule['run'] => () => [{ ruleId: 'X001', severity: 'high', message: 'm', location: { path }, fingerprint: `fp:${path}` }];
    const rules = [stubRule('X001', 'high', at('b.ts')), stubRule('X001', 'high', at('a.ts'))];
    const { report } = await runEngine(opts({ rules }));
    expect(report.findings.map((f) => f.location.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('acknowledgement by config fingerprint sets acknowledged and removes it from the counts', async () => {
    const first = await runEngine(opts());
    const target = first.report.findings.find((f) => f.severity === 'high')!;
    const highBefore = first.report.summary.findings.high;
    const config = cfg({ acknowledge: [{ fingerprint: target.fingerprint, reason: 'intended cleanup', by: 'maintainer', date: '2026-11-01' }] });
    const { report } = await runEngine(opts({ config }));
    const acked = report.findings.filter((f) => f.fingerprint === target.fingerprint);
    expect(acked.length).toBeGreaterThan(0);
    for (const f of acked) expect(f.acknowledged).toEqual({ by: 'maintainer', reason: 'intended cleanup', at: '2026-11-01', via: 'config' });
    expect(report.summary.findings.high).toBe(highBefore - acked.filter((f) => f.severity === 'high').length);
    expect(report.findings.filter((f) => f.fingerprint !== target.fingerprint).every((f) => f.acknowledged === undefined)).toBe(true);
  });

  it('acknowledging every open finding moves the state to unreadable when no evidence is given', async () => {
    const first = await runEngine(opts());
    const config = cfg({ acknowledge: first.report.findings.map((f) => ({ fingerprint: f.fingerprint, reason: 'r', by: 'b', date: 'd' })) });
    const { report } = await runEngine(opts({ config }));
    expect(report.summary.findings).toEqual({ high: 0, medium: 0, low: 0 });
    expect(report.state).toBe('unreadable');
    const withEvidence = await runEngine(opts({ config, evidence: evidence() }));
    expect(withEvidence.report.state).toBe('pass');
  });

  it('a configured severity of off disables a rule', async () => {
    const config = cfg({ rules: { R001: { severity: 'off', options: {} } } });
    const { report } = await runEngine(opts({ config }));
    expect(report.findings.map((f) => f.ruleId)).not.toContain('R001');
    expect(report.findings.map((f) => f.ruleId)).toContain('R003');
  });

  it('a configured severity overrides the finding severity', async () => {
    const rules = [stubRule('X001', 'high')];
    const config = cfg({ rules: { X001: { severity: 'low', options: {} } } });
    const { report } = await runEngine(opts({ rules, config }));
    expect(report.findings[0]!.severity).toBe('low');
    expect(report.summary.findings).toEqual({ high: 0, medium: 0, low: 1 });
  });

  it('a rule that throws is skipped and logged, others still run', async () => {
    const logs: string[] = [];
    const boom = stubRule('X009', 'high', () => {
      throw new Error('kaboom');
    });
    const rules = [boom, stubRule('X001', 'medium')];
    const { report } = await runEngine(opts({ rules, log: (m) => logs.push(m) }));
    expect(report.findings.map((f) => f.ruleId)).toEqual(['X001']);
    expect(logs.some((m) => m.startsWith('rule X009 failed:') && m.includes('kaboom'))).toBe(true);
  });

  it('a rejected async rule is skipped too', async () => {
    const logs: string[] = [];
    const boom = stubRule('X009', 'high', () => Promise.reject(new Error('async kaboom')));
    const { report } = await runEngine(opts({ rules: [boom], log: (m) => logs.push(m) }));
    expect(report.findings).toEqual([]);
    expect(logs.join('\n')).toContain('async kaboom');
  });

  it('skips rules that need junit when there is no evidence, and runs them with evidence', async () => {
    const needs: Rule = { ...stubRule('X004', 'high'), needs: ['diff', 'junit'] };
    expect((await runEngine(opts({ rules: [needs] }))).report.findings).toEqual([]);
    expect((await runEngine(opts({ rules: [needs], evidence: evidence() }))).report.findings).toHaveLength(1);
  });

  it('merges default and configured rule options', async () => {
    let seen: Record<string, unknown> | undefined;
    const rule: Rule = {
      ...stubRule('X005', 'low'),
      defaultOptions: { a: 1, b: 2 },
      run: (_ctx, o) => {
        seen = o;
        return [];
      },
    };
    const config = cfg({ rules: { X005: { severity: 'low', options: { b: 3, c: 4 } } } });
    await runEngine(opts({ rules: [rule], config }));
    expect(seen).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('the languages filter excludes a front end', async () => {
    const withTs = await runEngine(opts());
    expect(withTs.pairs[0]!.head).toBeDefined();
    const noTs = await runEngine(opts({ config: cfg({ languages: ['python'] }) }));
    expect(noTs.pairs).toHaveLength(1);
    expect(noTs.pairs[0]!.head).toBeUndefined();
    expect(noTs.pairs[0]!.base).toBeUndefined();
    const onlyTs = await runEngine(opts({ config: cfg({ languages: ['typescript'] }) }));
    expect(onlyTs.pairs[0]!.head).toBeDefined();
  });

  it('with no front ends no inventory is built', async () => {
    const { pairs } = await runEngine(opts({ frontEnds: [] }));
    expect(pairs[0]!.head).toBeUndefined();
  });

  it('reports unreadable evidence by default and read when evidence is given', async () => {
    const none = (await runEngine(opts())).report.evidence;
    expect(none.state).toBe('unreadable');
    expect(none.sources).toEqual([]);
    expect(none.total).toBe(0);
    expect(none.notes).toHaveLength(1);
    expect(none.notes[0]).toContain('No JUnit XML');
    const got = (await runEngine(opts({ evidence: evidence() }))).report.evidence;
    expect(got).toEqual({ state: 'read', sources: ['junit.xml'], total: 1, passed: 1, failed: 0, errored: 0, skipped: 0, flaky: 0, notes: [] });
  });

  it('marks partial evidence from the notes', async () => {
    const { report } = await runEngine(opts({ evidence: evidence(), evidenceNotes: ['Partial results: shard 2 missing'] }));
    expect(report.evidence.state).toBe('partial');
    expect(report.evidence.notes).toEqual(['Partial results: shard 2 missing']);
    const other = await runEngine(opts({ evidence: evidence(), evidenceNotes: ['all shards'] }));
    expect(other.report.evidence.state).toBe('read');
  });

  it('detects provenance from commit messages', async () => {
    const { report } = await runEngine(opts());
    expect(report.provenance.agents.length).toBeGreaterThan(0);
  });

  it('records timing as non negative integers', async () => {
    const { report } = await runEngine(opts());
    for (const v of Object.values(report.timing)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(report.timing.evidenceMs).toBe(0);
  });

  it('logs the resolved shas', async () => {
    const logs: string[] = [];
    await runEngine(opts({ log: (m) => logs.push(m) }));
    expect(logs[0]).toBe(`base ${base.slice(0, 10)} head ${head.slice(0, 10)}`);
  });

  it('resolved skips the merge base computation', async () => {
    const { report } = await runEngine(opts({ resolved: true }));
    expect(report.base).toBe(base);
  });

  it('rejects an unknown head ref', async () => {
    await expect(runEngine(opts({ head: 'nope' }))).rejects.toThrow();
  });

  it('reports pass when there are no test changes and no findings', async () => {
    const { report } = await runEngine(opts({ base, head: base }));
    expect(report.state).toBe('pass');
    expect(report.files.changed).toBe(0);
    expect(report.findings).toEqual([]);
  });
});

describe('computeState', () => {
  const c = defaultConfig();
  it('is review when an open finding meets the threshold', () => {
    expect(computeState([fakeFinding('high')], c, undefined, [])).toBe('review');
    expect(computeState([fakeFinding('high')], c, evidence(), [fakeFile('test')])).toBe('review');
  });
  it('ignores findings below failOn and acknowledged ones', () => {
    expect(computeState([fakeFinding('medium')], c, evidence(), [])).toBe('pass');
    expect(computeState([fakeFinding('medium')], { ...c, failOn: 'medium' }, evidence(), [])).toBe('review');
    expect(computeState([fakeFinding('low')], { ...c, failOn: 'low' }, evidence(), [])).toBe('review');
    const acked = fakeFinding('high', { acknowledged: { by: 'a', reason: 'r', at: 'd', via: 'config' } });
    expect(computeState([acked], c, evidence(), [])).toBe('pass');
  });
  it('is unreadable when no findings, no evidence and tests changed', () => {
    expect(computeState([], c, undefined, [fakeFile('test')])).toBe('unreadable');
    expect(computeState([], c, undefined, [fakeFile('runner-config')])).toBe('unreadable');
    expect(computeState([], c, undefined, [fakeFile('ci-workflow')])).toBe('unreadable');
  });
  it('is pass without evidence when no tests changed, or with evidence', () => {
    expect(computeState([], c, undefined, [fakeFile('production'), fakeFile('other'), fakeFile('snapshot')])).toBe('pass');
    expect(computeState([], c, undefined, [])).toBe('pass');
    expect(computeState([], c, evidence(), [fakeFile('test')])).toBe('pass');
  });
});

describe('exitCodeFor', () => {
  const rep = (state: Report['state']) => ({ state }) as Report;
  it('report mode always exits 0', () => {
    const c = cfg({ mode: 'report', requireEvidence: true });
    expect(exitCodeFor(rep('review'), c)).toBe(0);
    expect(exitCodeFor(rep('unreadable'), c)).toBe(0);
    expect(exitCodeFor(rep('pass'), c)).toBe(0);
  });
  it('strict and require-ack exit 1 on review', () => {
    expect(exitCodeFor(rep('review'), cfg({ mode: 'strict' }))).toBe(1);
    expect(exitCodeFor(rep('review'), cfg({ mode: 'require-ack' }))).toBe(1);
  });
  it('strict exits 3 on unreadable only with requireEvidence', () => {
    expect(exitCodeFor(rep('unreadable'), cfg({ mode: 'strict', requireEvidence: true }))).toBe(3);
    expect(exitCodeFor(rep('unreadable'), cfg({ mode: 'strict', requireEvidence: false }))).toBe(0);
    expect(exitCodeFor(rep('unreadable'), cfg({ mode: 'require-ack', requireEvidence: true }))).toBe(0);
  });
  it('pass exits 0', () => {
    expect(exitCodeFor(rep('pass'), cfg({ mode: 'strict', requireEvidence: true }))).toBe(0);
  });
});
