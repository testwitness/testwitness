// Fuzz: the config loader (docs/threat-model.md, "Fuzzing"). The config comes from the base ref.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fuzz, hostileText, mutated, TARGET_TIMEOUT_MS } from '../../../fuzz/kit.js';
import { ConfigError, parseConfig } from './config.js';
import { ruleMap } from './rules/index.js';

const CONFIG = [
  'version: 1\nmode: strict\nfail_on: medium\nrequire_evidence: true\nlanguages: [java, python]\npaths:\n  tests: ["spec/**"]\n  ignore: ["gen/**"]\n  followSymlinks: false\nresults:\n  head: "out/*.xml"\nrules:\n  R003: off\n  A002:\n    severity: high\nacknowledge:\n  - fingerprint: abc\n    reason: ok\n    by: maple\n    date: 2026-11-13\nprovenance:\n  show: false\nclaims:\n  enabled: true\n  phrases_extra: ["works on my machine"]\ncomment:\n  collapse_low: false\nprotect: ["src/**/*.golden"]\nhook:\n  timeout: 30\n  max_blocks: 3\n  blocking: [A002]\n  advice_only: [R004]\n',
  'a: &a [x, x, x]\nb: &b [*a, *a, *a]\nc: [*b, *b, *b]\nmode: report\n',
];

const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype).sort().join();
const pristine = (): void => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(PROTO_KEYS);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
};

describe('fuzz: config loader', () => {
  const rules = ruleMap();
  it('returns a config or throws ConfigError, never anything else, and never touches Object.prototype', async () => {
    await fuzz('config loader (YAML)', fc.oneof(mutated(CONFIG), hostileText(8)), (text) => {
      try {
        const cfg = parseConfig(text, rules);
        expect(['report', 'require-ack', 'strict']).toContain(cfg.mode);
        expect(['high', 'medium', 'low']).toContain(cfg.failOn);
        expect(typeof cfg.paths.followSymlinks).toBe('boolean');
        expect(typeof cfg.junit.head).toBe('string');
        expect(cfg.protect.every((p) => typeof p === 'string')).toBe(true);
        for (const [id, entry] of Object.entries(cfg.rules)) {
          expect(rules.has(id)).toBe(true);
          expect(['high', 'medium', 'low', 'off']).toContain(entry.severity);
        }
        expect(cfg.hook.timeoutSeconds > 0 && cfg.hook.timeoutSeconds <= 600).toBe(true);
        expect(cfg.hook.blocking.every((id) => rules.has(id))).toBe(true);
      } catch (err) {
        expect(err, String(err)).toBeInstanceOf(ConfigError);
      }
      pristine();
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: hostile configs', () => {
  it('a YAML alias bomb is refused quickly', () => {
    let yaml = 'a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n';
    for (let i = 1; i < 30; i++) yaml += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}, *a${i - 1}]\n`;
    const t0 = performance.now();
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('YAML that does not parse, and YAML tags, give a ConfigError', () => {
    expect(() => parseConfig('mode: [unclosed')).toThrow(ConfigError);
    expect(() => parseConfig('mode: !!js/function "function(){}"')).toThrow(ConfigError);
    expect(() => parseConfig('? [a, b]\n: c\nmode: strict')).not.toThrow(TypeError);
  });

  it('a config cannot reach Object.prototype through its keys', () => {
    for (const yaml of ['__proto__:\n  polluted: yes\n', 'rules:\n  __proto__: off\n', 'hook:\n  __proto__:\n    polluted: 1\n', 'constructor:\n  prototype:\n    polluted: 1\n']) {
      try {
        parseConfig(yaml, ruleMap());
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
      }
      pristine();
    }
  });
});
