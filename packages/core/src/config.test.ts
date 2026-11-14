import { describe, expect, it } from 'vitest';
import { applyConfiguredSeverity, ConfigError, pathMatcher, parseConfig } from './config.js';
import { ruleMap } from './rules/index.js';

const known = ruleMap();

describe('parseConfig', () => {
  it('returns defaults for empty input', () => {
    const c = parseConfig(undefined);
    expect(c.mode).toBe('report');
    expect(c.failOn).toBe('high');
    expect(c.languages).toBe('auto');
  });

  it('parses the documented example', () => {
    const c = parseConfig(
      `
version: 1
mode: strict
fail_on: medium
require_evidence: true
languages: [java, python]
paths:
  tests: ["src/test/**"]
  ignore: ["**/generated/**"]
junit:
  head: "**/x.xml"
assertions:
  extra: ["expectValid"]
rules:
  R003: high
  R001: off
acknowledge:
  - fingerprint: "R003:a.py:t"
    reason: "tracked in X-1"
    by: sajjad
    date: 2026-11-20
provenance:
  show: false
claims:
  phrases_extra: ["ran the full suite"]
`,
      known,
    );
    expect(c.mode).toBe('strict');
    expect(c.failOn).toBe('medium');
    expect(c.requireEvidence).toBe(true);
    expect(c.languages).toEqual(['java', 'python']);
    expect(c.paths.tests).toEqual(['src/test/**']);
    expect(c.paths.ignore).toContain('**/generated/**');
    expect(c.junit.head).toBe('**/x.xml');
    expect(c.assertions.extra).toEqual(['expectValid']);
    expect(c.rules['R003']?.severity).toBe('high');
    expect(c.rules['R001']?.severity).toBe('off');
    expect(c.acknowledge[0]).toEqual({ fingerprint: 'R003:a.py:t', reason: 'tracked in X-1', by: 'sajjad', date: '2026-11-20' });
    expect(c.provenance.show).toBe(false);
    expect(c.claims.phrasesExtra).toEqual(['ran the full suite']);
  });

  it('rejects unknown rules, bad severities and bad modes', () => {
    expect(() => parseConfig('rules:\n  Z999: high', known)).toThrow(ConfigError);
    expect(() => parseConfig('rules:\n  R003: loud', known)).toThrow(/severity/);
    expect(() => parseConfig('mode: yolo', known)).toThrow(/mode/);
    expect(() => parseConfig('rules:\n  R003:\n    bogus: 1', known)).toThrow(/takes no options|unknown option/);
  });

  it('reads results as the preferred key and junit as its alias, results winning', () => {
    expect(parseConfig('results:\n  head: "**/results.tap"', known).junit.head).toBe('**/results.tap');
    expect(parseConfig('junit:\n  head: "**/junit.xml"', known).junit.head).toBe('**/junit.xml');
    expect(parseConfig('junit:\n  head: "a.xml"\nresults:\n  head: "b.json"', known).junit.head).toBe('b.json');
    expect(parseConfig('results:\n  head: "a.xml"\njunit:\n  head: "b.json"', known).junit.head).toBe('a.xml');
    expect(() => parseConfig('results: "x"', known)).toThrow(/results must be a mapping/);
    expect(() => parseConfig('results:\n  head: 1', known)).toThrow(/results.head must be a string/);
  });

  it('rejects non mapping documents', () => {
    expect(() => parseConfig('- a\n- b', known)).toThrow(ConfigError);
  });
});

describe('applyConfiguredSeverity', () => {
  it('shifts findings by the same step the config moved the default', () => {
    expect(applyConfiguredSeverity('high', 'medium', 'high')).toBe('medium');
    expect(applyConfiguredSeverity('medium', 'medium', 'high')).toBe('low');
    expect(applyConfiguredSeverity('low', 'high', 'medium')).toBe('medium');
    expect(applyConfiguredSeverity('medium', 'medium', 'medium')).toBe('medium');
  });
});

describe('keys of features cut from v0.1', () => {
  it('fails with a ConfigError that names the key and says the feature is not in v0.1', () => {
    for (const [doc, key] of [
      ['mutation:\n  paths: ["reports/mutation/mutation.json"]\n', 'mutation'],
      ['mutation: yes\n', 'mutation'],
      ['history: history.json\n', 'history'],
      ['coverage:\n  paths: ["coverage/lcov.info"]\n', 'coverage'],
      ['coverage: yes\n', 'coverage'],
    ] as const) {
      expect(() => parseConfig(doc, known)).toThrow(ConfigError);
      expect(() => parseConfig(doc, known)).toThrow(new RegExp(`^${key}: .* is not in v0\\.1`));
    }
  });
  it('rejects M001, M002 and V008 as unknown rules', () => {
    expect(() => parseConfig('rules:\n  V008: medium\n', known)).toThrow(/unknown rule V008/);
    expect(() => parseConfig('rules:\n  M001: low\n', known)).toThrow(/unknown rule M001/);
    expect(() => parseConfig('rules:\n  M002: off\n', known)).toThrow(/unknown rule M002/);
  });
});

describe('configuration rule severities', () => {
  it('accepts severities for the C rules', () => {
    const c = parseConfig('rules:\n  C001: medium\n  C002: off\n  C003: low\n', known);
    expect([c.rules['C001']!.severity, c.rules['C002']!.severity, c.rules['C003']!.severity]).toEqual(['medium', 'off', 'low']);
  });
});

describe('agent hook config', () => {
  it('defaults: nothing protected, 20 s, two blocks, the proven blocking list', () => {
    const c = parseConfig(undefined);
    expect(c.protect).toEqual([]);
    expect(c.hook).toEqual({ timeoutSeconds: 20, maxBlocks: 2, blocking: ['A002', 'R003', 'R004', 'R005', 'W006'], adviceOnly: [] });
  });
  it('reads protect, hook.timeout, hook.max_blocks, hook.blocking and hook.advice_only', () => {
    const c = parseConfig('protect:\n  - "tests/golden/**"\n  - ".github/workflows/test.yml"\nhook:\n  timeout: 5\n  max_blocks: 3\n  blocking: [A002, R001, R002]\n  advice_only: [A002]\n', known);
    expect(c.protect).toEqual(['tests/golden/**', '.github/workflows/test.yml']);
    expect(c.hook).toEqual({ timeoutSeconds: 5, maxBlocks: 3, blocking: ['A002', 'R001', 'R002'], adviceOnly: ['A002'] });
    expect(parseConfig('hook:\n  advice_only: [R001, O002]\n', known).hook.adviceOnly).toEqual(['R001', 'O002']);
  });
  it('rejects wrong types, unknown keys, unknown rules and values out of range', () => {
    for (const bad of ['protect: "tests/**"\n', 'protect: [1]\n', 'hook: 5\n', 'hook:\n  timeout: 0\n', 'hook:\n  timeout: 601\n', 'hook:\n  timeout: "20"\n', 'hook:\n  max_blocks: 0\n', 'hook:\n  max_blocks: 1.5\n', 'hook:\n  max_blocks: 11\n', 'hook:\n  advice_only: [Z999]\n', 'hook:\n  advice_only: [r001]\n', 'hook:\n  blocking: [Z999]\n', 'hook:\n  blocking: all\n', 'hook:\n  retries: 2\n']) {
      expect(() => parseConfig(bad, known), bad).toThrow(ConfigError);
    }
  });
  it('pathMatcher matches globs, dot files included, and nothing when the list is empty', () => {
    expect(pathMatcher([])('a.ts')).toBe(false);
    const m = pathMatcher(['tests/golden/**', '.github/**']);
    expect([m('tests/golden/a/b.snap'), m('.github/workflows/ci.yml'), m('tests/unit/a.ts')]).toEqual([true, true, false]);
  });
});
