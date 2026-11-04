import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import {
  exitCodeFor,
  parseConfig,
  renderJson,
  renderMarkdown,
  ruleMap,
  runEngine,
  showFile,
  mergeBase,
  revParse,
  ConfigError,
  type Evidence,
  type PullRequestText,
  type Report,
  type ResolvedConfig,
} from '@testwitness/core';
import { readJunitFiles, toEvidence } from '@testwitness/junit';
import { allFrontEnds } from './frontends.js';

export interface CheckOptions {
  cwd: string;
  base: string;
  head: string;
  junit?: string | undefined;
  /** Path to .testwitness.yml; default reads it from the base ref, then the working tree. */
  config?: string | undefined;
  format: 'json' | 'markdown' | 'both';
  out?: string | undefined;
  prTitle?: string | undefined;
  prBodyFile?: string | undefined;
  /** PR author login, for provenance display only. */
  author?: string | undefined;
  /** PR author account type, e.g. User or Bot. */
  authorType?: string | undefined;
  mode?: ResolvedConfig['mode'] | undefined;
  failOn?: ResolvedConfig['failOn'] | undefined;
  quiet?: boolean;
  log?: (s: string) => void;
}

export interface CheckResult {
  report: Report;
  exitCode: number;
  config: ResolvedConfig;
}

export async function loadConfig(opts: CheckOptions): Promise<ResolvedConfig> {
  const rules = ruleMap();
  let source: string | undefined;
  if (opts.config) {
    source = await readFile(resolve(opts.cwd, opts.config), 'utf8');
  } else {
    // Config is read from the base ref in PR mode so a PR cannot relax its own check.
    try {
      const baseSha = await mergeBase(opts.base, await revParse(opts.head, { cwd: opts.cwd }), { cwd: opts.cwd });
      source = await showFile(baseSha, '.testwitness.yml', { cwd: opts.cwd });
    } catch {
      source = undefined;
    }
    if (source === undefined) {
      const local = resolve(opts.cwd, '.testwitness.yml');
      if (existsSync(local)) source = await readFile(local, 'utf8');
    }
  }
  const cfg = parseConfig(source, rules);
  if (opts.mode) cfg.mode = opts.mode;
  if (opts.failOn) cfg.failOn = opts.failOn;
  return cfg;
}

export async function loadEvidence(cwd: string, globs: string, log: (s: string) => void): Promise<{ evidence: Evidence | undefined; notes: string[] }> {
  const patterns = globs.split(',').map((s) => s.trim()).filter(Boolean);
  if (!patterns.length) return { evidence: undefined, notes: [] };
  const files = await fg(patterns, { cwd, absolute: true, onlyFiles: true, ignore: ['**/node_modules/**'], dot: true });
  if (!files.length) {
    log(`no JUnit XML matched ${globs}`);
    return { evidence: undefined, notes: [] };
  }
  const data = await readJunitFiles(files.sort());
  const notes = data.warnings.slice(0, 10);
  if (data.warnings.length > 10) notes.push(`${data.warnings.length - 10} more warnings`);
  return { evidence: toEvidence(data), notes };
}

export async function check(opts: CheckOptions): Promise<CheckResult> {
  const log = opts.log ?? ((s: string) => { if (!opts.quiet) process.stderr.write(`testwitness: ${s}\n`); });
  const config = await loadConfig(opts);
  const { evidence, notes } = await loadEvidence(opts.cwd, opts.junit ?? config.junit.head, log);
  let prText: PullRequestText | undefined;
  if (opts.prTitle !== undefined || opts.prBodyFile) {
    prText = { title: opts.prTitle ?? '', body: opts.prBodyFile ? await readFile(resolve(opts.cwd, opts.prBodyFile), 'utf8') : '' };
  }
  const { report } = await runEngine({
    cwd: opts.cwd,
    base: opts.base,
    head: opts.head,
    frontEnds: allFrontEnds(),
    config,
    evidence,
    evidenceNotes: notes,
    prText,
    ...(opts.author ? { author: { login: opts.author, type: opts.authorType } } : {}),
    log,
  });
  return { report, exitCode: exitCodeFor(report, config), config };
}

export function render(report: Report, format: CheckOptions['format'], collapseLow: boolean): string {
  if (format === 'json') return renderJson(report);
  if (format === 'markdown') return renderMarkdown(report, { collapseLow, marker: false });
  return renderMarkdown(report, { collapseLow, marker: false }) + '\n' + renderJson(report);
}

export { ConfigError };
