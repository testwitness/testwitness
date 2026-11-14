// `testwitness mcp`: a read only stdio MCP server, so a coding agent can run the check before it pushes
// and fix its own weakened tests. Three tools: testwitness_check, testwitness_explain_rule, testwitness_rules.
// Same three promises as the CLI: no model inside, no network, never runs the scanned repository's code.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { builtinRules, clipText, git, GitError, multiLine, oneLine, ruleMap, REPORT_SCHEMA, REPORT_SCHEMA_VERSION, TOOL_VERSION, type Finding, type Report } from '@testwitness/core';
import { check, ConfigError, defaultBase } from './check.js';

/** A git ref as an agent may pass it: no leading dash (it would read as a flag), no whitespace, no control characters. */
const ref = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^-\s]\S*$/, 'a git ref: no leading dash, no whitespace');

/**
 * Report globs as an agent may pass them: relative to the repository, never absolute and never through `..`. The CLI
 * allows both because a person or a workflow wrote the glob; here it comes from a model that may be acting on text it
 * read in the repository, and a results reader quotes a little of a file it cannot parse.
 */
export function staysInside(globs: string): boolean {
  return globs.split(',').every((g) => {
    const p = g.trim().replace(/\\/g, '/');
    return !p.startsWith('/') && !p.startsWith('~') && !/^[A-Za-z]:/.test(p) && !p.split('/').includes('..');
  });
}

const globs = z.string().max(1024).refine(staysInside, 'globs relative to cwd: no absolute path and no ..');

const CHECK_DESCRIPTION = [
  'Run testwitness on a local git repository: compare base and head and report tests that were deleted, skipped, emptied or loosened, assertions removed, failures hidden in CI config, and changed tests missing from the test results (JUnit XML, TAP or a JSON reporter).',
  'Read only. It reads the git history and files as text, never executes repository code (no install, no test run, no import of config files), and makes no network calls.',
  'Returns the report (JSON, schemaVersion 1, schema at ' + REPORT_SCHEMA + ') as structured content and a short text summary.',
  'Run it before pushing; fix every medium or high finding, or acknowledge it with a reason.',
].join(' ');

export { defaultBase } from './check.js';

/** Short plain text summary for the agent: state, counts, first five findings. */
export function summarise(report: Report): string {
  const c = report.summary.findings;
  const open = report.findings.filter((f) => !f.acknowledged);
  const lines = [
    `testwitness ${report.state}: ${c.high} high, ${c.medium} medium, ${c.low} low open findings (${report.findings.length - open.length} acknowledged). Evidence: ${report.evidence.state}.`,
  ];
  const where = (f: Finding) => `${f.location.path}${f.location.line ? `:${f.location.line}` : ''}`;
  // Messages and paths quote the repository; the summary is read by a model, so it gets one safe, bounded line each.
  for (const f of open.slice(0, 5)) lines.push(clipText(oneLine(`${f.severity} ${f.ruleId} ${where(f)}: ${f.message}${f.label ? ` (${f.label})` : ''}`), 1000));
  if (open.length > 5) lines.push(`${open.length - 5} more in the structured report.`);
  if (open.length === 0) lines.push('No open findings.');
  return lines.join('\n');
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `testwitness: ${clipText(multiLine(message), 4000)}` }] };
}

const severity = z.enum(['high', 'medium', 'low']);

export function createServer(): McpServer {
  const server = new McpServer({ name: 'testwitness', version: TOOL_VERSION });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    'testwitness_check',
    {
      title: 'Check a change for weakened tests',
      description: CHECK_DESCRIPTION,
      inputSchema: {
        cwd: z.string().min(1).describe('Absolute path of the git repository to check.'),
        base: ref.optional().describe("Base ref. The merge base with head is compared. Default: origin's default branch, else origin/main, origin/master, main or master."),
        head: ref.optional().describe('Head ref. Default HEAD (the last commit; uncommitted changes are not seen).'),
        results: globs.optional().describe('Comma separated globs of test results, relative to cwd: JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright, told apart by content. Default from .testwitness.yml.'),
        junit: globs.optional().describe('Older name of results; used when results is not given.'),
        coverage: globs.optional().describe('Comma separated globs of lcov, Cobertura or JaCoCo coverage reports, relative to cwd. Default from .testwitness.yml coverage.paths.'),
        mutation: globs.optional().describe('Comma separated globs of Stryker JSON or PIT mutations.xml reports, relative to cwd. Read only; the tool never runs a mutation tool. Default from .testwitness.yml mutation.paths.'),
        prTitle: z.string().max(10_000).optional().describe('Pull request title, for claim checks such as "all tests pass".'),
        prBody: z.string().max(200_000).optional().describe('Pull request body, for claim checks.'),
        mode: z.enum(['report', 'require-ack', 'strict']).optional().describe('Gate mode. It changes the state and exit decision only, never the findings. Default from .testwitness.yml.'),
      },
      // Loose on purpose: the full contract is docs/report.schema.json; this keeps clients that validate output happy as fields are added.
      outputSchema: z.looseObject({
        $schema: z.string(),
        schemaVersion: z.literal(REPORT_SCHEMA_VERSION).describe('Report shape version. Full JSON Schema: ' + REPORT_SCHEMA),
        state: z.enum(['pass', 'review', 'unreadable']),
        mode: z.enum(['report', 'require-ack', 'strict']),
        summary: z.looseObject({ findings: z.object({ high: z.number(), medium: z.number(), low: z.number() }) }),
        findings: z.array(z.looseObject({ ruleId: z.string(), severity, message: z.string(), location: z.looseObject({ path: z.string(), line: z.number().optional() }), fingerprint: z.string() })),
      }),
      annotations: { ...readOnly, title: 'testwitness check' },
    },
    async (args) => {
      const dir = resolve(args.cwd);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return errorResult(`${dir} is not a directory`);
      let top: string;
      try {
        top = (await git(['rev-parse', '--show-toplevel'], { cwd: dir })).trim();
      } catch {
        return errorResult(`${dir} is not inside a git repository`);
      }
      const notes: string[] = [];
      try {
        const { report } = await check({
          cwd: top,
          base: args.base ?? (await defaultBase(top)),
          head: args.head ?? 'HEAD',
          results: args.results,
          junit: args.junit,
          coverage: args.coverage,
          mutation: args.mutation,
          format: 'json',
          prTitle: args.prTitle ?? (args.prBody !== undefined ? '' : undefined),
          prBody: args.prBody,
          mode: args.mode,
          // As in the hook: the agent can write the working tree, so only the base config counts.
          configFromBaseOnly: true,
          quiet: true,
          log: (s) => notes.push(s),
        });
        const text = summarise(report) + (notes.length ? `\nNotes: ${notes.slice(0, 5).map((n) => clipText(oneLine(n), 500)).join('; ')}` : '');
        return { content: [{ type: 'text', text }], structuredContent: report as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof ConfigError || err instanceof GitError) return errorResult(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    'testwitness_explain_rule',
    {
      title: 'Explain a testwitness rule',
      description: 'Explain one testwitness rule: what it flags, how it avoids false positives, and an example diff. Use it to understand a finding before fixing it.',
      inputSchema: { ruleId: z.string().min(1).max(16).describe('Rule id from a finding, such as R001 or A002.') },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        defaultSeverity: severity,
        summary: z.string(),
        falsePositives: z.string(),
        example: z.string(),
      },
      annotations: { ...readOnly, title: 'Explain a rule' },
    },
    async ({ ruleId }) => {
      const rule = ruleMap().get(ruleId.trim().toUpperCase());
      if (!rule) return errorResult(`unknown rule ${ruleId}. Known rules: ${builtinRules().map((r) => r.id).join(', ')}`);
      const out = { id: rule.id, name: rule.name, defaultSeverity: rule.defaultSeverity, ...rule.docs };
      const text = `${rule.id} ${rule.name} (default ${rule.defaultSeverity})\n\n${rule.docs.summary}\n\nFalse positive controls: ${rule.docs.falsePositives}\n\nExample:\n${rule.docs.example}`;
      return { content: [{ type: 'text', text }], structuredContent: out };
    },
  );

  server.registerTool(
    'testwitness_rules',
    {
      title: 'List testwitness rules',
      description: 'List every built in testwitness rule with its id, name and default severity.',
      outputSchema: { rules: z.array(z.object({ id: z.string(), name: z.string(), defaultSeverity: severity })) },
      annotations: { ...readOnly, title: 'List rules' },
    },
    async () => {
      const rules = builtinRules().map((r) => ({ id: r.id, name: r.name, defaultSeverity: r.defaultSeverity }));
      const text = rules.map((r) => `${r.id}  ${r.defaultSeverity.padEnd(6)}  ${r.name}`).join('\n');
      return { content: [{ type: 'text', text }], structuredContent: { rules } };
    },
  );

  return server;
}

/**
 * Serve over stdio. Returns once connected; the open stdin keeps the process alive until the client closes it.
 * Nothing but protocol messages goes to stdout.
 */
export async function serveStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
