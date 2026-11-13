import { describe, expect, it } from 'vitest';
import { applyConfiguredSeverity, ConfigError, parseConfig } from './config.js';
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

describe('mutation config', () => {
  it('defaults to no mutation reports', () => {
    expect(parseConfig(undefined).mutation.paths).toEqual([]);
  });
  it('reads mutation.paths as a list or a comma separated string', () => {
    expect(parseConfig('mutation:\n  paths: ["reports/mutation/mutation.json", "**/mutations.xml"]\n', known).mutation.paths).toEqual(['reports/mutation/mutation.json', '**/mutations.xml']);
    expect(parseConfig('mutation:\n  paths: "a.json, b.xml"\n', known).mutation.paths).toEqual(['a.json', 'b.xml']);
  });
  it('rejects a mutation value that is not a mapping, and paths that are not strings', () => {
    expect(() => parseConfig('mutation: yes\n', known)).toThrow(ConfigError);
    expect(() => parseConfig('mutation:\n  paths: [1]\n', known)).toThrow(ConfigError);
  });
  it('accepts severities for M001 and M002', () => {
    const c = parseConfig('rules:\n  M001: low\n  M002: off\n', known);
    expect([c.rules['M001']!.severity, c.rules['M002']!.severity]).toEqual(['low', 'off']);
  });
});

describe('coverage config', () => {
  it('defaults to no coverage reports', () => {
    expect(parseConfig(undefined).coverage.paths).toEqual([]);
  });
  it('reads coverage.paths as a list or a comma separated string', () => {
    expect(parseConfig('coverage:\n  paths: ["coverage/lcov.info", "**/jacoco.xml"]\n', known).coverage.paths).toEqual(['coverage/lcov.info', '**/jacoco.xml']);
    expect(parseConfig('coverage:\n  paths: "coverage.xml, lcov.info"\n', known).coverage.paths).toEqual(['coverage.xml', 'lcov.info']);
  });
  it('rejects a coverage value that is not a mapping, and paths that are not strings', () => {
    expect(() => parseConfig('coverage: yes\n', known)).toThrow(ConfigError);
    expect(() => parseConfig('coverage:\n  paths: [1, 2]\n', known)).toThrow(ConfigError);
  });
  it('accepts severities for the C rules and V008', () => {
    const c = parseConfig('rules:\n  C001: medium\n  C002: off\n  C003: low\n  V008: medium\n', known);
    expect([c.rules['C001']!.severity, c.rules['C002']!.severity, c.rules['C003']!.severity, c.rules['V008']!.severity]).toEqual(['medium', 'off', 'low', 'medium']);
  });
});
