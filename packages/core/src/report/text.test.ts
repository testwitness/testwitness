import { describe, expect, it } from 'vitest';
import { plain, renderText } from './text.js';
import type { Finding, Report } from '../types.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'R001',
    severity: 'high',
    message: 'Test removed',
    location: { path: 'src/a.test.ts', line: 12 },
    fingerprint: 'fp',
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    $schema: 'https://testwitness.github.io/testwitness/report.schema.json',
    schemaVersion: '1',
    tool: { name: 'testwitness', version: '9.9.9' },
    generatedAt: '2026-11-03T00:00:00.000Z',
    state: 'review',
    mode: 'report',
    summary: {
      testsDeleted: 2,
      testsSkipped: 3,
      assertionsWeakened: 4,
      changedTestsNotRun: 5,
      findings: { high: 1, medium: 2, low: 3 },
    },
    findings: [],
    evidence: {
      state: 'read',
      sources: ['a.xml', 'b.xml'],
      total: 10,
      passed: 7,
      failed: 1,
      errored: 1,
      skipped: 1,
      flaky: 0,
      notes: [],
    },
    provenance: { agents: [] },
    files: {
      changed: 7,
      tests: 3,
      production: 4,
      config: 0,
      workflows: 0,
      snapshots: 0,
    },
    timing: { totalMs: 321, parseMs: 1, rulesMs: 2, evidenceMs: 0 },
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    ...over,
  };
}

describe('plain', () => {
  it('turns control characters, ESC and C1 included, into a placeholder and line breaks into spaces', () => {
    expect(plain('a\u001b[31mb')).toBe('a�[31mb');
    expect(plain('a\u009bb\u0007c')).toBe('a�b�c');
    expect(plain('a\r\nb\nc\td')).toBe('a b c d');
  });
  it('leaves ordinary text, unicode included, alone', () => {
    expect(plain('cart › applies 10% | `x`')).toBe('cart › applies 10% | `x`');
  });
});

describe('renderText', () => {
  it('prints the state, then findings high first with before and after, then the summary', () => {
    const out = renderText(
      report({
        findings: [
          finding({
            ruleId: 'R003',
            severity: 'medium',
            message: 'Test b is now skipped',
            location: { path: 'src/a.test.ts', line: 30 },
          }),
          finding({
            ruleId: 'A002',
            severity: 'high',
            message: 'toEqual became toBeDefined',
            location: { path: 'src/a.test.ts', line: 10 },
            before: 'expect(x).toEqual(180)',
            after: 'expect(x).toBeDefined()',
          }),
        ],
      }),
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe(
      'testwitness: review, this change alters what its tests prove; a reviewer should look',
    );
    expect(out.indexOf('A002')).toBeLessThan(out.indexOf('R003'));
    expect(out).toContain(
      '  high    A002  src/a.test.ts:10\n          toEqual became toBeDefined\n          before: expect(x).toEqual(180)\n          after:  expect(x).toBeDefined()',
    );
    expect(out).toContain(
      '1 high, 2 medium, 3 low. Tests deleted 2, skipped 3, assertions weakened 4.',
    );
    expect(out).toContain(
      'Results: 10 tests in 2 files, 7 passed, 1 failed, 1 errored, 1 skipped. Changed tests that did not run: 5.',
    );
    expect(out).not.toContain('\u001b[');
    expect(out).not.toMatch(/\|---/);
  });

  it('colours only when asked', () => {
    const out = renderText(report({ findings: [finding()] }), { color: true });
    expect(out).toContain('\u001b[31;1mhigh  \u001b[0m');
    expect(out).toContain('\u001b[33;1mreview\u001b[0m');
  });

  it('never passes terminal escapes from test names or messages through, even with colour on', () => {
    const out = renderText(
      report({
        findings: [
          finding({
            message: 'name \u001b]0;pwned\u0007 x',
            location: { path: 'a\u001b[2J.ts', line: 1 },
          }),
        ],
      }),
      { color: true },
    );
    expect(out).not.toContain('\u001b]0;');
    expect(out).not.toContain('\u001b[2J');
    expect(out).toContain('name �]0;pwned� x');
  });

  it('hides low findings behind a count when collapsing, and lists acknowledged ones only as a count', () => {
    const out = renderText(
      report({
        findings: [
          finding({ severity: 'low', ruleId: 'R001', label: 'moved' }),
          finding({ severity: 'low', ruleId: 'A001' }),
          finding({
            severity: 'high',
            ruleId: 'R005',
            acknowledged: {
              by: 'sam',
              reason: 'debugging',
              at: '2026-11-01',
              via: 'config',
            },
          }),
        ],
      }),
      { collapseLow: true },
    );
    expect(out).toContain('2 low findings not shown');
    expect(out).toContain('1 acknowledged finding not shown');
    expect(out).not.toContain('R005');
    expect(
      renderText(
        report({ findings: [finding({ severity: 'low', label: 'moved' })] }),
      ),
    ).toContain('Test removed (moved)');
  });

  it('says plainly when no results were read', () => {
    const out = renderText(
      report({
        state: 'unreadable',
        evidence: {
          state: 'unreadable',
          sources: [],
          total: 0,
          passed: 0,
          failed: 0,
          errored: 0,
          skipped: 0,
          flaky: 0,
          notes: ['No result files matched'],
        },
      }),
    );
    expect(out.split('\n')[0]).toBe(
      'testwitness: unreadable, the diff rules ran, but no test results were read to confirm what ran',
    );
    expect(out).toContain(
      'Results: none read, so whether the changed tests ran is unknown (pass --results to check).',
    );
    expect(out).toContain('  No result files matched');
  });
});
