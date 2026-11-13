import { parse as parseYaml } from 'yaml';
import type { LanguageId, Mode, ResolvedConfig, Rule, RuleConfigEntry, Severity, SeveritySetting } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_JUNIT_GLOB = '**/junit*.xml,**/TEST-*.xml,**/test-results/**/*.xml,**/surefire-reports/*.xml,**/failsafe-reports/*.xml';

export function defaultConfig(): ResolvedConfig {
  return {
    version: 1,
    mode: 'report',
    failOn: 'high',
    requireEvidence: false,
    languages: 'auto',
    paths: { tests: [], ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**', '**/.venv/**'], followSymlinks: false },
    junit: { head: DEFAULT_JUNIT_GLOB, base: '' },
    coverage: { paths: [] },
    mutation: { paths: [] },
    assertions: { extra: [] },
    rules: {},
    acknowledge: [],
    provenance: { show: true, stricterForAgents: false },
    claims: { enabled: true, phrasesExtra: [] },
    comment: { enabled: true, collapseLow: true },
  };
}

const SEVERITIES = new Set<string>(['high', 'medium', 'low', 'off']);
const MODES = new Set<string>(['report', 'require-ack', 'strict']);
const LANGS = new Set<string>(['java', 'typescript', 'javascript', 'python']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown, key: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ConfigError(`${key} must be a list of strings`);
  return v as string[];
}

/**
 * Parse and validate a `.testwitness.yml` document. Unknown rule ids and options are
 * errors, not silently ignored, when `knownRules` is provided.
 */
export function parseConfig(source: string | undefined, knownRules?: ReadonlyMap<string, Rule>): ResolvedConfig {
  const cfg = defaultConfig();
  if (!source || !source.trim()) return cfg;
  const doc: unknown = parseYaml(source);
  if (doc === null || doc === undefined) return cfg;
  if (!isRecord(doc)) throw new ConfigError('config must be a mapping');

  if (doc['version'] !== undefined && doc['version'] !== 1) throw new ConfigError(`unsupported config version ${String(doc['version'])}`);
  if (doc['mode'] !== undefined) {
    if (typeof doc['mode'] !== 'string' || !MODES.has(doc['mode'])) throw new ConfigError(`mode must be one of report, require-ack, strict`);
    cfg.mode = doc['mode'] as Mode;
  }
  if (doc['fail_on'] !== undefined) {
    if (typeof doc['fail_on'] !== 'string' || !['high', 'medium', 'low'].includes(doc['fail_on'])) throw new ConfigError('fail_on must be high, medium or low');
    cfg.failOn = doc['fail_on'] as Severity;
  }
  if (doc['require_evidence'] !== undefined) {
    if (typeof doc['require_evidence'] !== 'boolean') throw new ConfigError('require_evidence must be a boolean');
    cfg.requireEvidence = doc['require_evidence'];
  }
  if (doc['languages'] !== undefined) {
    const langs = stringList(doc['languages'], 'languages');
    for (const l of langs) if (!LANGS.has(l)) throw new ConfigError(`unknown language ${l}`);
    cfg.languages = langs as LanguageId[];
  }
  if (doc['paths'] !== undefined) {
    if (!isRecord(doc['paths'])) throw new ConfigError('paths must be a mapping');
    const tests = stringList(doc['paths']['tests'], 'paths.tests');
    const ignore = stringList(doc['paths']['ignore'], 'paths.ignore');
    if (tests.length) cfg.paths.tests = tests;
    if (ignore.length) cfg.paths.ignore = [...cfg.paths.ignore, ...ignore];
    const follow = doc['paths']['followSymlinks'] ?? doc['paths']['follow_symlinks'];
    if (follow !== undefined) {
      if (typeof follow !== 'boolean') throw new ConfigError('paths.followSymlinks must be a boolean');
      cfg.paths.followSymlinks = follow;
    }
  }
  // `results` is the preferred key; `junit` is its older name and still works. When both are set, `results` wins.
  for (const key of ['junit', 'results'] as const) {
    const section = doc[key];
    if (section === undefined) continue;
    if (!isRecord(section)) throw new ConfigError(`${key} must be a mapping`);
    if (section['head'] !== undefined) {
      if (typeof section['head'] !== 'string') throw new ConfigError(`${key}.head must be a string`);
      cfg.junit.head = section['head'];
    }
    if (section['base'] !== undefined) {
      if (typeof section['base'] !== 'string') throw new ConfigError(`${key}.base must be a string`);
      cfg.junit.base = section['base'];
    }
  }
  if (doc['coverage'] !== undefined) {
    if (!isRecord(doc['coverage'])) throw new ConfigError('coverage must be a mapping');
    const p = doc['coverage']['paths'];
    cfg.coverage.paths = typeof p === 'string' ? p.split(',').map((s) => s.trim()).filter(Boolean) : stringList(p, 'coverage.paths');
  }
  if (doc['mutation'] !== undefined) {
    if (!isRecord(doc['mutation'])) throw new ConfigError('mutation must be a mapping');
    const p = doc['mutation']['paths'];
    cfg.mutation.paths = typeof p === 'string' ? p.split(',').map((s) => s.trim()).filter(Boolean) : stringList(p, 'mutation.paths');
  }
  if (doc['assertions'] !== undefined) {
    if (!isRecord(doc['assertions'])) throw new ConfigError('assertions must be a mapping');
    cfg.assertions.extra = stringList(doc['assertions']['extra'], 'assertions.extra');
  }
  if (doc['rules'] !== undefined) {
    if (!isRecord(doc['rules'])) throw new ConfigError('rules must be a mapping of rule id to severity or options');
    for (const [id, value] of Object.entries(doc['rules'])) {
      if (!/^[A-Z]\d{3}$/.test(id)) throw new ConfigError(`invalid rule id ${id}`);
      if (knownRules && !knownRules.has(id)) throw new ConfigError(`unknown rule ${id}`);
      const entry: RuleConfigEntry = { severity: knownRules?.get(id)?.defaultSeverity ?? 'medium', options: {} };
      if (typeof value === 'string') {
        if (!SEVERITIES.has(value)) throw new ConfigError(`rule ${id}: severity must be high, medium, low or off`);
        entry.severity = value as SeveritySetting;
      } else if (isRecord(value)) {
        const { severity, ...rest } = value;
        if (severity !== undefined) {
          if (typeof severity !== 'string' || !SEVERITIES.has(severity)) throw new ConfigError(`rule ${id}: severity must be high, medium, low or off`);
          entry.severity = severity as SeveritySetting;
        }
        const schema = knownRules?.get(id)?.optionsSchema;
        if (knownRules && schema) {
          const props = (schema['properties'] ?? {}) as Record<string, unknown>;
          for (const k of Object.keys(rest)) {
            if (!(k in props)) throw new ConfigError(`rule ${id}: unknown option ${k}`);
          }
        } else if (knownRules && Object.keys(rest).length) {
          throw new ConfigError(`rule ${id} takes no options`);
        }
        entry.options = rest;
      } else {
        throw new ConfigError(`rule ${id}: expected a severity or a mapping`);
      }
      cfg.rules[id] = entry;
    }
  }
  if (doc['acknowledge'] !== undefined) {
    if (!Array.isArray(doc['acknowledge'])) throw new ConfigError('acknowledge must be a list');
    for (const a of doc['acknowledge']) {
      if (!isRecord(a) || typeof a['fingerprint'] !== 'string' || typeof a['reason'] !== 'string') {
        throw new ConfigError('each acknowledge entry needs fingerprint and reason');
      }
      cfg.acknowledge.push({
        fingerprint: a['fingerprint'],
        reason: a['reason'],
        by: typeof a['by'] === 'string' ? a['by'] : 'config',
        date: a['date'] instanceof Date ? a['date'].toISOString().slice(0, 10) : typeof a['date'] === 'string' ? a['date'] : '',
      });
    }
  }
  if (doc['provenance'] !== undefined) {
    if (!isRecord(doc['provenance'])) throw new ConfigError('provenance must be a mapping');
    if (typeof doc['provenance']['show'] === 'boolean') cfg.provenance.show = doc['provenance']['show'];
    if (typeof doc['provenance']['stricter_for_agents'] === 'boolean') cfg.provenance.stricterForAgents = doc['provenance']['stricter_for_agents'];
  }
  if (doc['claims'] !== undefined) {
    if (!isRecord(doc['claims'])) throw new ConfigError('claims must be a mapping');
    if (typeof doc['claims']['enabled'] === 'boolean') cfg.claims.enabled = doc['claims']['enabled'];
    cfg.claims.phrasesExtra = stringList(doc['claims']['phrases_extra'], 'claims.phrases_extra');
  }
  if (doc['comment'] !== undefined) {
    if (!isRecord(doc['comment'])) throw new ConfigError('comment must be a mapping');
    if (typeof doc['comment']['enabled'] === 'boolean') cfg.comment.enabled = doc['comment']['enabled'];
    if (typeof doc['comment']['collapse_low'] === 'boolean') cfg.comment.collapseLow = doc['comment']['collapse_low'];
  }
  return cfg;
}

/** Effective severity for a rule given config, or 'off'. */
export function effectiveSeverity(rule: Rule, cfg: ResolvedConfig): SeveritySetting {
  return cfg.rules[rule.id]?.severity ?? rule.defaultSeverity;
}

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Cap a finding's severity at the configured severity for the rule (config can lower, and raise, the default). */
export function applyConfiguredSeverity(found: Severity, configured: SeveritySetting, ruleDefault: Severity): Severity {
  if (configured === 'off') return found;
  if (configured === ruleDefault) return found;
  // Shift by the same number of steps the config moved the default.
  const delta = SEVERITY_RANK[configured] - SEVERITY_RANK[ruleDefault];
  const rank = Math.min(3, Math.max(1, SEVERITY_RANK[found] + delta));
  return (Object.keys(SEVERITY_RANK) as Severity[]).find((s) => SEVERITY_RANK[s] === rank)!;
}
