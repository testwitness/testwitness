import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, esc, renderMarkdown } from './markdown.js';
import { renderJson } from './json.js';
import type { Finding, Report } from '../types.js';

function finding(over: Partial<Finding> = {}): Finding {
  return { ruleId: 'R001', severity: 'high', message: 'Test removed', location: { path: 'src/a.test.ts', line: 12 }, fingerprint: 'fp', ...over };
}

function report(over: Partial<Report> = {}): Report {
  return {
    $schema: 'https://testwitness.github.io/testwitness/report.schema.json',
    schemaVersion: '1',
    tool: { name: 'testwitness', version: '9.9.9' },
    generatedAt: '2026-11-03T00:00:00.000Z',
    state: 'review',
    mode: 'strict',
    summary: { testsDeleted: 2, testsSkipped: 3, assertionsWeakened: 4, changedTestsNotRun: 5, findings: { high: 1, medium: 2, low: 3 } },
    findings: [],
    evidence: { state: 'read', sources: ['a.xml', 'b.xml'], total: 10, passed: 7, failed: 1, errored: 1, skipped: 1, flaky: 0, notes: [] },
    provenance: { agents: [] },
    files: { changed: 7, tests: 3, production: 4, config: 0, workflows: 0, snapshots: 0 },
    timing: { totalMs: 321, parseMs: 1, rulesMs: 2, evidenceMs: 0 },
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    ...over,
  };
}

describe('esc', () => {
  it('escapes every markdown special character', () => {
    for (const c of ['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '!', '|', '<', '>']) {
      expect(esc(`a${c}b`)).toBe(`a\\${c}b`);
    }
  });
  it('replaces newlines of both kinds with a space', () => {
    expect(esc('a\nb')).toBe('a b');
    expect(esc('a\r\nb')).toBe('a b');
    expect(esc('a\n\nb')).toBe('a  b');
  });
  it('leaves plain text alone', () => {
    expect(esc('plain text 123 . , : - ~')).toBe('plain text 123 . , : - ~');
  });
  it('escapes a table breaking name', () => {
    expect(esc('a | b\nc')).toBe('a \\| b c');
  });
});

describe('renderMarkdown header', () => {
  it('includes the marker by default and omits it when marker is false', () => {
    const withMarker = renderMarkdown(report());
    expect(withMarker.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
    expect(renderMarkdown(report(), { marker: true }).startsWith(COMMENT_MARKER)).toBe(true);
    const without = renderMarkdown(report(), { marker: false });
    expect(without).not.toContain(COMMENT_MARKER);
    expect(without.startsWith('## testwitness: review')).toBe(true);
  });
  it('uses a custom title', () => {
    expect(renderMarkdown(report(), { title: 'Custom' })).toContain('## Custom: review');
  });
  it.each([
    ['pass', 'pass: no finding at or above the configured threshold'],
    ['review', 'review: this PR changed what its tests prove. A reviewer should look.'],
    ['unreadable', 'unreadable: the diff rules ran, but no test results were available to confirm what ran'],
  ] as const)('state line for %s', (state, line) => {
    const md = renderMarkdown(report({ state }));
    expect(md).toContain(`## testwitness: ${state}\n\n${line}\n`);
  });
  it('ends with a single trailing newline', () => {
    const md = renderMarkdown(report());
    expect(md.endsWith('</sub>\n')).toBe(true);
  });
});

describe('renderMarkdown summary', () => {
  it('prints each count', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('**Summary**');
    expect(md).toContain('- Tests deleted: 2');
    expect(md).toContain('- Tests skipped or expected to fail: 3');
    expect(md).toContain('- Assertions removed or loosened: 4');
    expect(md).toContain('- Changed tests that did not run: 5');
    expect(md).toContain('- Findings: 1 high, 2 medium, 3 low');
  });
  it('says unknown for tests that did not run when evidence is unreadable', () => {
    const md = renderMarkdown(report({ evidence: { ...report().evidence, state: 'unreadable' } }));
    expect(md).toContain('- Changed tests that did not run: unknown (no results)');
    expect(md).not.toContain('did not run: 5');
  });
});

describe('renderMarkdown findings', () => {
  it('has no findings table when there are none', () => {
    const md = renderMarkdown(report());
    expect(md).not.toContain('**Findings**');
    expect(md).not.toContain('<details>');
  });
  it('lists high and medium rows in the main table with their location', () => {
    const md = renderMarkdown(
      report({
        findings: [
          finding({ ruleId: 'R001', severity: 'high', message: 'high one', location: { path: 'a.test.ts', line: 3 } }),
          finding({ ruleId: 'A001', severity: 'medium', message: 'medium one', location: { path: 'b.test.ts' } }),
        ],
      }),
    );
    expect(md).toContain('**Findings**\n\n| Rule | Severity | Where | What |\n|---|---|---|---|\n');
    expect(md).toContain('| R001 | high | `a.test.ts:3` | high one |');
    expect(md).toContain('| A001 | medium | `b.test.ts` | medium one |');
    expect(md).not.toContain('<details>');
  });
  it('appends the label in parentheses and escapes it', () => {
    const md = renderMarkdown(report({ findings: [finding({ label: 'moved *fast*' })] }));
    expect(md).toContain('| Test removed (moved \\*fast\\*) |');
  });
  it('escapes markdown and newlines in messages and locations', () => {
    const md = renderMarkdown(report({ findings: [finding({ message: 'Test `x` | y\nz <b>', location: { path: 'a_b.test.ts', line: 1 } })] }));
    expect(md).toContain('Test \\`x\\` \\| y z \\<b\\>');
    expect(md).toContain('`a\\_b.test.ts:1`');
    expect(md).not.toContain('y\nz');
  });
  it('keeps low rows in the main table when collapseLow is off', () => {
    const md = renderMarkdown(report({ findings: [finding({ severity: 'low', message: 'low one' })] }));
    expect(md).toContain('**Findings**');
    expect(md).toContain('| R001 | low |');
    expect(md).not.toContain('<details>');
  });
  it('collapses low rows under details when collapseLow is on', () => {
    const md = renderMarkdown(report({ findings: [finding({ severity: 'low', message: 'low one' }), finding({ severity: 'low', message: 'low two' })] }), { collapseLow: true });
    expect(md).not.toContain('**Findings**');
    expect(md).toContain('<details>\n<summary>2 low severity findings</summary>');
    expect(md).toContain('| R001 | low |');
    expect(md).toContain('</details>');
  });
  it('uses the singular for one low finding', () => {
    const md = renderMarkdown(report({ findings: [finding({ severity: 'low' })] }), { collapseLow: true });
    expect(md).toContain('<summary>1 low severity finding</summary>');
  });
  it('splits high rows from collapsed low rows', () => {
    const md = renderMarkdown(report({ findings: [finding({ message: 'HIGHROW' }), finding({ severity: 'low', message: 'LOWROW' })] }), { collapseLow: true });
    expect(md.indexOf('HIGHROW')).toBeLessThan(md.indexOf('<details>'));
    expect(md.indexOf('LOWROW')).toBeGreaterThan(md.indexOf('<details>'));
  });
  it('puts acknowledged rows under their own details with the reason', () => {
    const acked = finding({ message: 'ACKED', acknowledged: { by: 'dana', reason: 'intended *cleanup*', at: '2026-11-01', via: 'config' } });
    const md = renderMarkdown(report({ findings: [acked, finding({ message: 'OPEN' })] }));
    expect(md).toContain('<summary>1 acknowledged</summary>');
    expect(md).toContain('ACKED acknowledged by dana: intended \\*cleanup\\*');
    expect(md.indexOf('OPEN')).toBeLessThan(md.indexOf('<details>'));
    expect(md.indexOf('ACKED')).toBeGreaterThan(md.indexOf('<details>'));
  });
  it('an all acknowledged report has no main table', () => {
    const acked = finding({ acknowledged: { by: 'a', reason: 'r', at: 'd', via: 'comment' } });
    const md = renderMarkdown(report({ findings: [acked] }));
    expect(md).not.toContain('**Findings**');
    expect(md).toContain('<summary>1 acknowledged</summary>');
  });
  it('acknowledged low findings stay out of the low details', () => {
    const acked = finding({ severity: 'low', acknowledged: { by: 'a', reason: 'r', at: 'd', via: 'label' } });
    const md = renderMarkdown(report({ findings: [acked] }), { collapseLow: true });
    expect(md).not.toContain('low severity finding');
    expect(md).toContain('1 acknowledged');
  });
});

describe('renderMarkdown evidence', () => {
  it('summarises read evidence', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('**Evidence**');
    expect(md).toContain('- Read 2 result files: 10 tests, 7 passed, 1 failed, 1 errored, 1 skipped\n');
    expect(md).not.toContain('flaky');
  });
  it('uses the singular for one result file and shows flaky counts', () => {
    const md = renderMarkdown(report({ evidence: { ...report().evidence, sources: ['a.xml'], flaky: 2 } }));
    expect(md).toContain('- Read 1 result file: 10 tests');
    expect(md).toContain('1 skipped, 2 flaky');
  });
  it('names the formats read unless they are JUnit XML alone', () => {
    const md = renderMarkdown(report({ evidence: { ...report().evidence, formats: ['jest-json', 'junit-xml', 'tap'] } }));
    expect(md).toContain('- Read 2 result files (Jest JSON, JUnit XML, TAP): 10 tests');
    const xml = renderMarkdown(report({ evidence: { ...report().evidence, formats: ['junit-xml'] } }));
    expect(xml).toContain('- Read 2 result files: 10 tests');
  });
  it('says no test results for unreadable evidence', () => {
    const md = renderMarkdown(report({ evidence: { ...report().evidence, state: 'unreadable' } }));
    expect(md).toContain('- No test results read.');
    expect(md).not.toContain('- Read ');
  });
  it('lists notes with escaping', () => {
    const md = renderMarkdown(report({ evidence: { ...report().evidence, notes: ['first_note', 'second (note)'] } }));
    expect(md).toContain('- first\\_note');
    expect(md).toContain('- second \\(note\\)');
  });
});

describe('renderMarkdown provenance', () => {
  it('is absent without agents or a bot author', () => {
    expect(renderMarkdown(report())).not.toContain('**Provenance**');
  });
  it('lists agents and their signals', () => {
    const md = renderMarkdown(report({ provenance: { agents: [{ name: 'Claude', signals: ['trailer', 'branch name'] }] } }));
    expect(md).toContain('**Provenance**');
    expect(md).toContain('- Claude: trailer; branch name');
    expect(md).not.toContain('Bot author');
  });
  it('lists a bot author alone', () => {
    const md = renderMarkdown(report({ provenance: { agents: [], botAuthor: 'dependabot[bot]' } }));
    expect(md).toContain('**Provenance**');
    expect(md).toContain('- Bot author: dependabot\\[bot\\]');
  });
  it('escapes agent names and signals', () => {
    const md = renderMarkdown(report({ provenance: { agents: [{ name: 'a_b', signals: ['x*y'] }] } }));
    expect(md).toContain('- a\\_b: x\\*y');
  });
});

describe('renderMarkdown footer', () => {
  it('carries version, mode, file counts and milliseconds', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('<sub>testwitness 9.9.9, mode strict, 7 files changed (3 test files), 321 ms. Findings are observations, not verdicts. Acknowledge one with a reason in `.testwitness.yml`.</sub>');
  });
  it('reflects another mode', () => {
    expect(renderMarkdown(report({ mode: 'report' }))).toContain('mode report,');
  });
});

describe('renderJson', () => {
  it('round trips through JSON.parse', () => {
    const r = report({ findings: [finding({ label: 'x', before: 'b', after: 'a' })], provenance: { agents: [{ name: 'n', signals: ['s'] }], botAuthor: 'bot' } });
    const text = renderJson(r);
    expect(JSON.parse(text)).toEqual(r);
  });
  it('is indented with two spaces and ends with a newline', () => {
    const text = renderJson(report());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "$schema": "https://testwitness.github.io/testwitness/report.schema.json",');
  });
});

describe('coverage line', () => {
  it('shows a short Coverage line in the evidence section when coverage was read, and nothing otherwise', () => {
    const md = renderMarkdown(report({ coverage: { sources: ['coverage.xml'], files: 12, linesInstrumented: 400, linesExecuted: 310, notes: ['coverage: stopped after 200 report files'] } }));
    expect(md).toContain('- Coverage: 1 report, 12 source files, 310 of 400 instrumented lines executed');
    expect(md).toContain('stopped after 200 report files');
    expect(renderMarkdown(report())).not.toContain('Coverage:');
  });
});

describe('mutation line', () => {
  it('shows a short Mutation line in the evidence section when mutation reports were read, and nothing otherwise', () => {
    const md = renderMarkdown(report({ mutation: { sources: ['reports/mutation/mutation.json'], files: 2, mutants: 30, killed: 21, survived: 6, noCoverage: 3, notes: ['The mutation reports name no killing tests, so M002 is silent.'] } }));
    expect(md).toContain('- Mutation: 1 report, 2 source files, 30 mutants: 21 killed, 6 survived, 3 not covered');
    expect(md).toContain('M002 is silent');
    expect(renderMarkdown(report())).not.toContain('Mutation:');
  });
});
