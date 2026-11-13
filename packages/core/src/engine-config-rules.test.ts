// End to end through runEngine for the configuration rules (C001, C002, C003) and coverage (V008): registration,
// the configured severity, acknowledgement by fingerprint, and the coverage section of the report.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tsFrontEnd } from '../../lang-ts/src/index.js';
import { runEngine } from './engine.js';
import { parseConfig } from './config.js';
import { ruleMap } from './rules/index.js';
import { readCoverageString, toCoverageEvidence } from './coverage/reader.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
let dir: string;
let base: string;
let head: string;

function sh(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });
}
function put(path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-engine-c-'));
  sh('init', '-q', '-b', 'main');
  sh('config', 'commit.gpgsign', 'false');
  put('src/calc.ts', 'export const add = (a: number, b: number) => a + b;\n');
  put('src/calc.test.ts', "import { add } from './calc';\nit('adds', () => { expect(add(1, 2)).toBe(3); });\n");
  put('src/slow/big.test.ts', "it('big', () => { expect(1).toBe(1); });\n");
  put('jest.config.js', "module.exports = {\n  coverageThreshold: { global: { lines: 90 } },\n  testPathIgnorePatterns: ['/node_modules/'],\n};\n");
  put('package.json', '{\n  "scripts": {\n    "test": "jest"\n  }\n}\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  base = sh('rev-parse', 'HEAD').trim();
  put('src/calc.ts', 'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => {\n  return a - b;\n};\n');
  put('jest.config.js', "module.exports = {\n  coverageThreshold: { global: { lines: 70 } },\n  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/slow/'],\n};\n");
  put('package.json', '{\n  "scripts": {\n    "test": "jest --passWithNoTests"\n  }\n}\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'head');
  head = sh('rev-parse', 'HEAD').trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const LCOV = (root: string) => `SF:${root}/src/calc.ts\nDA:1,3\nDA:2,1\nDA:3,0\nend_of_record\n`;

describe('configuration and coverage rules through the engine', () => {
  it('keeps ignored paths away from the configuration rules too', async () => {
    const config = parseConfig('paths:\n  ignore:\n    - "jest.config.js"\n    - "package.json"\n');
    const { report } = await runEngine({ cwd: dir, base, head, frontEnds: [tsFrontEnd], config, resolved: true, helperIndex: false });
    expect(report.findings.filter((f) => f.ruleId.startsWith('C'))).toEqual([]);
  });

  it('reports C001, C002 and C003, and V008 only when coverage is attached', async () => {
    const without = await runEngine({ cwd: dir, base, head, frontEnds: [tsFrontEnd], config: parseConfig(undefined), resolved: true, helperIndex: false });
    const ids = without.report.findings.map((f) => `${f.ruleId} ${f.severity}`).sort();
    expect(ids).toEqual(['C001 high', 'C002 medium', 'C003 high', 'V005 low']);
    expect(without.report.coverage).toBeUndefined();

    const coverage = toCoverageEvidence(await readCoverageString(LCOV(dir), 'lcov.info', dir));
    const withCov = await runEngine({ cwd: dir, base, head, frontEnds: [tsFrontEnd], config: parseConfig(undefined), resolved: true, helperIndex: false, coverage });
    const v008 = withCov.report.findings.find((f) => f.ruleId === 'V008');
    expect(v008).toMatchObject({ severity: 'low', label: 'uncovered change', location: { path: 'src/calc.ts', line: 3 } });
    expect(withCov.report.coverage).toEqual({ sources: ['lcov.info'], files: 1, linesInstrumented: 3, linesExecuted: 2, notes: [] });
  });

  it('applies configured severities and acknowledgements by fingerprint', async () => {
    const first = await runEngine({ cwd: dir, base, head, frontEnds: [tsFrontEnd], config: parseConfig(undefined), resolved: true, helperIndex: false });
    const c002 = first.report.findings.find((f) => f.ruleId === 'C002')!;
    expect(c002.fingerprint).toBe('C002:jest.config.js:jest.coverageThreshold.global.lines');
    const yaml = `rules:\n  C001: medium\n  C003: off\nacknowledge:\n  - fingerprint: "${c002.fingerprint}"\n    reason: "lowered while the billing module is rewritten"\n    by: maintainer\n`;
    const second = await runEngine({ cwd: dir, base, head, frontEnds: [tsFrontEnd], config: parseConfig(yaml, ruleMap()), resolved: true, helperIndex: false });
    const byRule = new Map(second.report.findings.map((f) => [f.ruleId, f]));
    expect(byRule.get('C001')!.severity).toBe('medium');
    expect(byRule.has('C003')).toBe(false);
    expect(byRule.get('C002')!.acknowledged).toMatchObject({ by: 'maintainer', via: 'config' });
    expect(second.report.summary.findings.medium).toBe(1);
  });
});
