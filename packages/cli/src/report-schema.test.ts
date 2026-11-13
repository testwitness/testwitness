// The JSON report is a public contract: docs/report.schema.json describes it and agents read it through
// the MCP server. These tests validate real engine output against the schema and fail when the engine
// gains a rule id or a finding label that the schema does not list (or the schema keeps one that is gone).
import { readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { builtinRules, emptyHistory, HISTORY_SCHEMA, mergeHistory, parseHistory, REPORT_SCHEMA, REPORT_SCHEMA_VERSION, serializeHistory } from '@testwitness/core';
import { check, render } from './check.js';
import { discoverCases, runCase, type GoldenCase } from '../../../fixtures/runner/golden.js';
import { generate, SMALL } from '../../../bench/generate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const schema = JSON.parse(readFileSync(join(root, 'docs/report.schema.json'), 'utf8')) as {
  $id: string;
  $defs: { ruleId: { enum: string[] }; label: { enum: string[] }; severity: { enum: string[] } };
  properties: { schemaVersion: { const: string } };
};

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ } });
  return ajv.compile(schema);
}

function expectValid(json: unknown): void {
  const validate = validator();
  const ok = validate(json);
  expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
}

/** A spread of golden cases: the first case of every fixture project, and in each project the first with PR text, with JUnit XML and with a labelled finding. */
function sampleCases(): GoldenCase[] {
  const all = discoverCases(join(root, 'fixtures'));
  const picked = new Map<string, GoldenCase>();
  const byProject = new Map<string, GoldenCase[]>();
  for (const c of all) byProject.set(c.project, [...(byProject.get(c.project) ?? []), c]);
  for (const cases of byProject.values()) {
    for (const c of [cases[0], cases.find((x) => x.pr), cases.find((x) => x.junit), cases.find((x) => x.expected.some((e) => e.label))]) {
      if (c) picked.set(`${c.project}/${c.name}`, c);
    }
  }
  return [...picked.values()];
}

describe('report schema', () => {
  it('compiles under JSON Schema draft 2020-12 and matches the engine constants', () => {
    expect(() => validator()).not.toThrow();
    expect(schema.$id).toBe(REPORT_SCHEMA);
    expect(schema.properties.schemaVersion.const).toBe(REPORT_SCHEMA_VERSION);
    expect(schema.$defs.severity.enum).toEqual(['high', 'medium', 'low']);
  });

  const cases = sampleCases();
  it('samples golden cases from every fixture project', () => {
    expect(new Set(cases.map((c) => c.project)).size).toBe(9);
    expect(cases.some((c) => c.pr)).toBe(true);
    expect(cases.some((c) => c.junit)).toBe(true);
  });

  for (const c of cases) {
    it(`validates the JSON output of golden case ${c.project}/${c.name}`, async () => {
      const { report } = await runCase(c);
      expectValid(JSON.parse(render(report, 'json', false)));
    }, 60_000);
  }

  it('validates the JSON output of the bench small case', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-schema-bench-'));
    try {
      const gen = generate({ ...SMALL, dir });
      const { report, config } = await check({ cwd: gen.repo, base: gen.baseSha, head: gen.headSha, junit: gen.junitGlob, format: 'json', quiet: true, log: () => {} });
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.evidence.state).toBe('read');
      expectValid(JSON.parse(render(report, 'json', config.comment.collapseLow)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects a report with an unknown rule id, label or extra field', () => {
    const validate = validator();
    const base = {
      $schema: REPORT_SCHEMA,
      schemaVersion: '1',
      tool: { name: 'testwitness', version: '0.1.0' },
      generatedAt: '2026-11-04T00:00:00.000Z',
      state: 'review',
      mode: 'report',
      summary: { testsDeleted: 0, testsSkipped: 0, assertionsWeakened: 0, changedTestsNotRun: 0, findings: { high: 0, medium: 1, low: 0 } },
      findings: [{ ruleId: 'R001', severity: 'medium', message: 'm', location: { path: 'a.test.ts', line: 3 }, fingerprint: 'fp', label: 'moved' }],
      evidence: { state: 'unreadable', sources: [], total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0, notes: [] },
      provenance: { agents: [] },
      files: { changed: 1, tests: 1, production: 0, config: 0, workflows: 0, snapshots: 0 },
      timing: { totalMs: 1, parseMs: 0, rulesMs: 0, evidenceMs: 0 },
      base: 'a',
      head: 'b',
    };
    expect(validate(base)).toBe(true);
    const withFinding = (f: Record<string, unknown>) => ({ ...base, findings: [{ ...base.findings[0], ...f }] });
    expect(validate(withFinding({ ruleId: 'Z999' }))).toBe(false);
    expect(validate(withFinding({ label: 'not a label' }))).toBe(false);
    expect(validate(withFinding({ severity: 'critical' }))).toBe(false);
    expect(validate({ ...base, extra: true })).toBe(false);
    expect(validate({ ...base, schemaVersion: '2' })).toBe(false);
    const history = { source: 'history.json', runs: 5, tests: 9, adjusted: 1, notes: [] };
    expect(validate({ ...base, history })).toBe(true);
    expect(validate(withFinding({ label: 'hides failure' }))).toBe(true);
    expect(validate({ ...base, history: { ...history, extra: 1 } })).toBe(false);
    expect(validate({ ...base, history: { ...history, runs: -1 } })).toBe(false);
    const withoutAdjusted: Record<string, unknown> = { ...history };
    delete withoutAdjusted['adjusted'];
    expect(validate({ ...base, history: withoutAdjusted })).toBe(false);
  });

  const historyCases = discoverCases(join(root, 'fixtures'), (c) => c.history !== undefined);
  it('has golden cases with a run history in three fixture projects', () => {
    expect(new Set(historyCases.map((c) => c.project))).toEqual(new Set(['java-junit4-gradle', 'ts-jest', 'py-pytest']));
  });
  for (const c of historyCases.filter((x) => x.name.includes('hides-failure'))) {
    it(`validates the JSON output of history case ${c.project}/${c.name}`, async () => {
      const { report } = await runCase(c);
      const json = JSON.parse(render(report, 'json', false));
      expect(json.history).toMatchObject({ runs: 5, adjusted: 1 });
      expectValid(json);
    }, 60_000);
  }
});

describe('history schema', () => {
  const historySchema = JSON.parse(readFileSync(join(root, 'docs/history.schema.json'), 'utf8')) as { $id: string };
  const validateHistory = () => new Ajv2020({ allErrors: true, strict: true }).compile(historySchema);

  it('compiles and matches the engine constant', () => {
    expect(() => validateHistory()).not.toThrow();
    expect(historySchema.$id).toBe(HISTORY_SCHEMA);
  });

  it('validates every history document committed with the golden fixtures, and the engine reads each one', () => {
    const validate = validateHistory();
    const docs = discoverCases(join(root, 'fixtures'), (c) => c.history !== undefined).map((c) => readFileSync(c.history!, 'utf8'));
    expect(docs.length).toBeGreaterThanOrEqual(9);
    for (const text of docs) {
      expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
      expect(parseHistory(text).error).toBeUndefined();
    }
  });

  it('validates what the engine writes, including empty and truncated documents', () => {
    const validate = validateHistory();
    const results = Array.from({ length: 50 }, (_, i) => ({ key: `a::t${i}`, status: i % 7 === 0 ? ('failed' as const) : ('passed' as const), reruns: i % 11 === 0 ? 1 : 0 }));
    for (const doc of [emptyHistory(), mergeHistory(undefined, { id: '1', date: '2026-11-04' }, results), mergeHistory(undefined, { id: '1', date: '2026-11-04' }, results, { maxBytes: 900 })]) {
      expect(validate(JSON.parse(serializeHistory(doc))), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('rejects documents the engine would refuse, and the engine refuses them too', () => {
    const validate = validateHistory();
    const ok = JSON.parse(serializeHistory(mergeHistory(undefined, { id: '1', date: '2026-11-04' }, [{ key: 'a::x', status: 'passed', reruns: 0 }])));
    const bad = [
      { ...ok, schemaVersion: '2' },
      { ...ok, tests: { 'a::x': 'X' } },
      { ...ok, runs: [{ ...ok.runs[0], total: -1 }] },
      { ...ok, extra: true },
      { ...ok, window: 0 },
    ];
    for (const doc of bad) {
      expect(validate(doc)).toBe(false);
    }
    // The engine is stricter on alignment than JSON Schema can be; the schema rejects every shape error above as well.
    for (const doc of bad.slice(0, 3)) expect(parseHistory(JSON.stringify(doc)).error).toBeDefined();
  });
});

/** Finding labels assigned in rule sources: `label: 'x'`, `label = 'x'`, `label ?? 'x'`, `let label: T = c ? undefined : 'x'`. */
function labelsInRuleSources(): Set<string> {
  const dir = join(root, 'packages/core/src/rules');
  const out = new Set<string>();
  const assign = /\blabel(?:\s*=(?!=)|\s*\?\?|:\s*(?=')|: string \| undefined =)/;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.') && f !== 'testkit.ts')) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const m = assign.exec(line);
      if (!m) continue;
      // The assigned expression ends at the first comma, semicolon or closing brace outside a string literal.
      const expr = /^(?:'[^']*'|[^,;}'])*/.exec(line.slice(m.index + m[0].length))?.[0] ?? '';
      for (const lit of expr.matchAll(/'([^']+)'/g)) out.add(lit[1]!);
    }
  }
  return out;
}

describe('report schema stays in step with the engine', () => {
  it('lists exactly the built in rule ids', () => {
    const engine = builtinRules().map((r) => r.id).sort();
    const listed = [...schema.$defs.ruleId.enum].sort();
    expect(engine.filter((id) => !listed.includes(id)), 'rule ids missing from docs/report.schema.json $defs.ruleId').toEqual([]);
    expect(listed.filter((id) => !engine.includes(id)), 'rule ids in docs/report.schema.json that no rule has').toEqual([]);
  });

  it('lists exactly the finding labels the rules assign', () => {
    const engine = [...labelsInRuleSources()].sort();
    const listed = [...schema.$defs.label.enum].sort();
    expect(engine.length).toBeGreaterThan(15);
    expect(engine.filter((l) => !listed.includes(l)), 'labels missing from docs/report.schema.json $defs.label').toEqual([]);
    expect(listed.filter((l) => !engine.includes(l)), 'labels in docs/report.schema.json that no rule assigns').toEqual([]);
  });

  it('covers every label the golden fixtures expect', () => {
    const expected = new Set(discoverCases(join(root, 'fixtures')).flatMap((c) => c.expected.flatMap((e) => (e.label ? [e.label] : []))));
    expect([...expected].filter((l) => !schema.$defs.label.enum.includes(l))).toEqual([]);
  });
});
