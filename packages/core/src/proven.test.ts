import { describe, expect, it } from 'vitest';
import { defaultConfig, HOOK_BLOCKING, HOOK_BLOCKING_UNMEASURED, parseConfig } from './config.js';
import { capUnproven, GATE_RULES, isCapped, measuredSeverity, PROVEN_RULES, UNPROVEN_SEVERITY_CAP } from './proven.js';
import { builtinRules, ruleMap } from './rules/index.js';
import type { Finding, Severity } from './types.js';

const finding = (ruleId: string, severity: Severity): Finding => ({ ruleId, severity, message: 'm', location: { path: 'a.ts' }, fingerprint: `${ruleId}:a` });

describe('the proven rules of v0.1', () => {
  it('are R003, R004, R005 and A002, and each is a built in rule', () => {
    expect([...PROVEN_RULES].sort()).toEqual(['A002', 'R003', 'R004', 'R005']);
    const ids = new Set(builtinRules().map((r) => r.id));
    for (const id of [...PROVEN_RULES, ...GATE_RULES]) expect(ids.has(id), id).toBe(true);
    expect(UNPROVEN_SEVERITY_CAP).toBe('low');
  });

  it('are the agent hook blocking list, with W006 as the one exception', () => {
    expect([...HOOK_BLOCKING]).toEqual(['A002', 'R003', 'R004', 'R005', 'W006']);
    expect([...HOOK_BLOCKING_UNMEASURED]).toEqual(['W006']);
    expect(defaultConfig().hook.blocking).toEqual([...HOOK_BLOCKING]);
  });
});

describe('capUnproven', () => {
  it('caps every unproven rule at low and keeps what the rule said in uncappedSeverity', () => {
    const fs = [finding('R001', 'high'), finding('C001', 'medium'), finding('O001', 'low')];
    expect(capUnproven(fs, defaultConfig())).toBe(2);
    expect(fs.map((f) => [f.severity, f.uncappedSeverity])).toEqual([
      ['low', 'high'],
      ['low', 'medium'],
      ['low', 'low'],
    ]);
    expect(fs.map(measuredSeverity)).toEqual(['high', 'medium', 'low']);
  });

  it('leaves the proven rules and W006 alone, without an uncappedSeverity field', () => {
    const fs = [...PROVEN_RULES, ...GATE_RULES].map((id) => finding(id, 'high'));
    expect(capUnproven(fs, defaultConfig())).toBe(0);
    for (const f of fs) {
      expect(f.severity).toBe('high');
      expect('uncappedSeverity' in f).toBe(false);
      expect(measuredSeverity(f)).toBe('high');
    }
  });

  it('caps a rule the engine does not know too (a custom rule is unproven)', () => {
    expect(isCapped('X999', defaultConfig())).toBe(true);
  });
});

describe('opting a rule back in through .testwitness.yml', () => {
  const known = ruleMap();
  it('a severity for the rule, short or long form, opts it in', () => {
    for (const yaml of ['rules:\n  R001: medium\n', 'rules:\n  R001:\n    severity: medium\n', 'rules:\n  R001: high\n']) {
      const cfg = parseConfig(yaml, known);
      expect(cfg.rules['R001']!.explicitSeverity, yaml).toBe(true);
      expect(isCapped('R001', cfg), yaml).toBe(false);
      const fs = [finding('R001', 'high')];
      capUnproven(fs, cfg);
      expect(fs[0]!.severity).toBe('high');
      expect(fs[0]!.uncappedSeverity).toBeUndefined();
    }
  });

  it('a mapping without a severity does not opt a rule in, and opting in one rule leaves the others capped', () => {
    const cfg = parseConfig('rules:\n  R002: {}\n  R001: medium\n', known);
    expect(cfg.rules['R002']!.explicitSeverity).toBeUndefined();
    expect(isCapped('R002', cfg)).toBe(true);
    expect(isCapped('R001', cfg)).toBe(false);
    expect(isCapped('A001', cfg)).toBe(true);
  });

});
