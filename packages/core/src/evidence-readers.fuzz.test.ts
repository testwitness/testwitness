// Fuzz: the coverage readers (lcov, Cobertura, JaCoCo) and the config loader (docs/threat-model.md, "Fuzzing").
// Coverage reports are written by the pull request's own run; the config comes from the base ref.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fuzz, hostileText, mutated, TARGET_TIMEOUT_MS } from '../../../fuzz/kit.js';
import { ConfigError, parseConfig } from './config.js';
import { readCoverageString, toCoverageEvidence } from './coverage/reader.js';
import { ruleMap } from './rules/index.js';
import { XML_MAX_ERRORS } from './xml-errors.js';

const LCOV = ['TN:\nSF:/repo/src/math.ts\nFN:1,add\nFNDA:3,add\nDA:1,3\nDA:2,0\nDA:3,1\nLF:3\nLH:2\nBRDA:2,0,0,-\nend_of_record\nSF:src\\win\\path.ts\nDA:10,1\nend_of_record\n'];
const COBERTURA = ['<?xml version="1.0" ?>\n<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">\n<coverage line-rate="0.5" version="7"><sources><source>/repo/src</source><source>.</source></sources><packages><package name="p"><classes><class name="m" filename="pkg/math.py" line-rate="1"><methods><method name="f"><lines><line number="1" hits="1"/></lines></method></methods><lines><line number="1" hits="1"/><line number="2" hits="0" branch="true"/></lines></class></classes></package></packages></coverage>'];
const JACOCO = ['<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="demo"><sessioninfo id="x" start="1" dump="2"/><package name="com/acme"><class name="com/acme/Cart" sourcefilename="Cart.java"><method name="add" desc="()V" line="3"/></class><sourcefile name="Cart.java"><line nr="3" mi="0" ci="2" mb="0" cb="0"/><line nr="4" mi="2" ci="0"/><counter type="LINE" missed="1" covered="1"/></sourcefile></package></report>'];
const CONFIG = [
  'version: 1\nmode: strict\nfail_on: medium\nrequire_evidence: true\nlanguages: [java, python]\npaths:\n  tests: ["spec/**"]\n  ignore: ["gen/**"]\n  followSymlinks: false\nresults:\n  head: "out/*.xml"\ncoverage:\n  paths: "coverage/lcov.info, cov.xml"\nrules:\n  R003: off\n  A002:\n    severity: high\nacknowledge:\n  - fingerprint: abc\n    reason: ok\n    by: maple\n    date: 2026-11-13\nprovenance:\n  show: false\nclaims:\n  enabled: true\n  phrases_extra: ["works on my machine"]\ncomment:\n  collapse_low: false\nprotect: ["src/**/*.golden"]\nhook:\n  timeout: 30\n  max_blocks: 3\n  blocking: [A002]\n  advice_only: [R004]\n',
  'a: &a [x, x, x]\nb: &b [*a, *a, *a]\nc: [*b, *b, *b]\nmode: report\n',
];

const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype).sort().join();
const pristine = (): void => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(PROTO_KEYS);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
};

describe('fuzz: coverage readers', () => {
  for (const [name, seeds] of [['lcov reader', LCOV], ['cobertura reader', COBERTURA], ['jacoco reader', JACOCO]] as const) {
    it(`${name}: never rejects, counts stay consistent, lookups never throw`, async () => {
      await fuzz(name, fc.tuple(mutated(seeds), hostileText(3)), async ([text, lookup]) => {
        const data = await readCoverageString(text, 'cov', '/repo');
        const ev = toCoverageEvidence(data);
        expect(ev.linesExecuted).toBeLessThanOrEqual(ev.linesInstrumented);
        expect(ev.files).toBe(data.files.size);
        for (const f of data.files.values()) for (const n of f.instrumented) expect(Number.isInteger(n) && n >= 1).toBe(true);
        expect(data.warnings.length).toBeLessThanOrEqual(XML_MAX_ERRORS + 3);
        ev.lookup(lookup);
        ev.lookup('src/math.ts');
      });
    }, TARGET_TIMEOUT_MS);
  }
});

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
        expect(cfg.coverage.paths.every((p) => typeof p === 'string') && cfg.protect.every((p) => typeof p === 'string')).toBe(true);
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

describe('regression: hostile reports and configs', () => {
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

  it('coverage files with one XML error every few bytes give a handful of notes', async () => {
    const cov = await readCoverageString(`<coverage>${'&x;'.repeat(100_000)}</coverage>`);
    expect(cov.warnings.length).toBeLessThanOrEqual(XML_MAX_ERRORS + 3);
  }, 60_000);

  it('external entities in a coverage report are not resolved', async () => {
    const data = await readCoverageString('<?xml version="1.0"?><!DOCTYPE coverage [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><coverage><packages><package><classes><class filename="&xxe;"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>');
    expect([...data.files.keys()]).toEqual(['&xxe;']);
  });
});
