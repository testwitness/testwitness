// Starts the MCP server in process over the SDK's in memory transport and calls every tool the way an agent would.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { builtinRules } from '@testwitness/core';
import { createServer, defaultBase } from './mcp.js';
import { TMP } from './testing/repo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ } });
const validateReport = ajv.compile(JSON.parse(readFileSync(join(root, 'docs/report.schema.json'), 'utf8')));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@testwitness.local', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@testwitness.local' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });

/** A repository on branch weaken whose head deletes one test and loosens an assertion in another. */
function weakenedRepo(dir: string): void {
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  git(dir, 'init', '-q', '-b', 'main');
  write('src/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
  write(
    'src/math.test.ts',
    [
      "import { describe, expect, it } from 'vitest';",
      "import { add } from './math';",
      '',
      "describe('add', () => {",
      "  it('adds two numbers', () => {",
      '    expect(add(1, 2)).toBe(3);',
      '  });',
      '',
      "  it('handles negatives', () => {",
      '    expect(add(-1, -2)).toBe(-3);',
      '  });',
      '});',
      '',
    ].join('\n'),
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'weaken');
  write(
    'src/math.test.ts',
    ["import { describe, expect, it } from 'vitest';", "import { add } from './math';", '', "describe('add', () => {", "  it('adds two numbers', () => {", '    expect(add(1, 2)).toBeDefined();', '  });', '});', ''].join('\n'),
  );
  git(dir, 'commit', '-q', '-am', 'weaken tests');
}

let client: Client;
let repo: string;

beforeAll(async () => {
  repo = mkdtempSync(join(TMP, 'tw-mcp-'));
  weakenedRepo(repo);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: 'mcp-test', version: '0.0.0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  rmSync(repo, { recursive: true, force: true });
});

const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n');

describe('testwitness mcp server', () => {
  it('lists exactly the three read only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['testwitness_check', 'testwitness_explain_rule', 'testwitness_rules']);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(false);
      expect(t.outputSchema).toBeDefined();
    }
    const checkTool = tools.find((t) => t.name === 'testwitness_check')!;
    expect(checkTool.description).toMatch(/never executes repository code/);
    expect(checkTool.description).toMatch(/no network/);
    expect(checkTool.inputSchema.required).toEqual(['cwd']);
    expect(Object.keys(checkTool.inputSchema.properties ?? {}).sort()).toEqual(['base', 'coverage', 'cwd', 'head', 'junit', 'mode', 'mutation', 'prBody', 'prTitle', 'results']);
  });

  it('testwitness_rules lists every built in rule with its default severity', async () => {
    const r = await client.callTool({ name: 'testwitness_rules', arguments: {} });
    expect(r.isError).toBeFalsy();
    const rules = (r.structuredContent as { rules: Array<{ id: string; name: string; defaultSeverity: string }> }).rules;
    expect(rules).toEqual(builtinRules().map((x) => ({ id: x.id, name: x.name, defaultSeverity: x.defaultSeverity })));
    expect(text(r)).toContain('R001  medium  Test function deleted');
  });

  it('testwitness_explain_rule returns the rule docs from the catalogue', async () => {
    const rule = builtinRules().find((x) => x.id === 'A002')!;
    const r = await client.callTool({ name: 'testwitness_explain_rule', arguments: { ruleId: 'a002' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ id: 'A002', name: rule.name, defaultSeverity: rule.defaultSeverity, ...rule.docs });
    expect(text(r)).toContain('False positive controls:');
  });

  it('testwitness_explain_rule reports an unknown rule as a tool error', async () => {
    const r = await client.callTool({ name: 'testwitness_explain_rule', arguments: { ruleId: 'Z999' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/unknown rule Z999/);
  });

  it('testwitness_check finds the weakening and returns a report that validates against the schema', async () => {
    const r = await client.callTool({ name: 'testwitness_check', arguments: { cwd: repo, base: 'main', prTitle: 'Tidy tests', prBody: 'All tests pass.' } });
    expect(r.isError, text(r)).toBeFalsy();
    const report = r.structuredContent as { schemaVersion: string; state: string; findings: Array<{ ruleId: string; location: { path: string } }> };
    expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);
    expect(report.schemaVersion).toBe('1');
    expect(report.state).toBe('review');
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids).toContain('R001');
    expect(ids).toContain('A002');
    const summary = text(r);
    expect(summary).toMatch(/^testwitness review: \d+ high, \d+ medium, \d+ low open findings/);
    expect(summary).toMatch(/R001 src\/math\.test\.ts:\d+: /);
  });

  it('testwitness_check picks a default base when none is given', async () => {
    expect(await defaultBase(repo)).toBe('main');
    const r = await client.callTool({ name: 'testwitness_check', arguments: { cwd: repo, mode: 'report' } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(validateReport(r.structuredContent)).toBe(true);
    expect((r.structuredContent as { mode: string }).mode).toBe('report');
  });

  it('testwitness_check refuses refs that would read as git flags', async () => {
    const r = await client.callTool({ name: 'testwitness_check', arguments: { cwd: repo, base: '--output=/tmp/x' } });
    expect(r.isError).toBe(true);
  });

  it('testwitness_check reports a directory that is not a repository as a tool error', async () => {
    const empty = mkdtempSync(join(TMP, 'tw-mcp-empty-'));
    try {
      const r = await client.callTool({ name: 'testwitness_check', arguments: { cwd: empty } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/not inside a git repository/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
