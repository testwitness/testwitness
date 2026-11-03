/**
 * GitHub Action entry. Reads inputs from the environment (never from `${{ }}`
 * interpolation into shell), runs the check, writes the JSON and Markdown
 * reports, emits workflow command annotations, and posts or updates one PR
 * comment when the token can write. Works with no token at all.
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { check } from 'testwitness';
import { renderJson, renderMarkdown, COMMENT_MARKER, type Finding, type Report } from '@testwitness/core';

function annotationLevel(f: Finding, strict: boolean): 'error' | 'warning' | 'notice' {
  if (f.severity === 'high') return strict ? 'error' : 'warning';
  if (f.severity === 'medium') return 'warning';
  return 'notice';
}

export async function run(): Promise<void> {
  const cwd = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  const baseInput = core.getInput('base');
  const headInput = core.getInput('head');
  const base = baseInput || (pr ? (pr['base'] as { sha: string }).sha : 'origin/main');
  const head = headInput || (pr ? (pr['head'] as { sha: string }).sha : 'HEAD');
  const junit = core.getInput('junit') || undefined;
  const mode = (core.getInput('mode') || undefined) as 'report' | 'require-ack' | 'strict' | undefined;
  const failOn = (core.getInput('fail_on') || undefined) as 'high' | 'medium' | 'low' | undefined;
  const configPath = core.getInput('config') || undefined;
  const commentEnabled = (core.getInput('comment') || 'true') !== 'false';
  const outDir = core.getInput('output_dir') || '.';

  // PR text comes from the event payload file, read as data.
  let prTitle: string | undefined;
  let prBodyFile: string | undefined;
  if (pr) {
    prTitle = String(pr['title'] ?? '');
    prBodyFile = resolve(cwd, '.testwitness-pr-body.txt');
    await writeFile(prBodyFile, String(pr['body'] ?? ''));
  }

  const { report, exitCode, config } = await check({ cwd, base, head, junit, mode, failOn, config: configPath, format: 'json', prTitle, prBodyFile, quiet: false });

  const jsonPath = resolve(cwd, outDir, 'testwitness.json');
  const mdPath = resolve(cwd, outDir, 'testwitness.md');
  const markdown = renderMarkdown(report, { collapseLow: config.comment.collapseLow, marker: true });
  await writeFile(jsonPath, renderJson(report));
  await writeFile(mdPath, markdown);
  core.setOutput('state', report.state);
  core.setOutput('report', jsonPath);
  core.setOutput('findings_high', String(report.summary.findings.high));
  core.setOutput('findings_medium', String(report.summary.findings.medium));

  // Annotations render on the Files tab without any token.
  const strict = config.mode === 'strict';
  for (const f of report.findings.slice(0, 200)) {
    if (f.acknowledged) continue;
    const props = { file: f.location.path, startLine: f.location.line ?? 1, title: `testwitness ${f.ruleId}` };
    const msg = `${f.message}${f.label ? ` (${f.label})` : ''}`;
    const level = annotationLevel(f, strict);
    if (level === 'error') core.error(msg, props);
    else if (level === 'warning') core.warning(msg, props);
    else core.notice(msg, props);
  }

  try {
    await core.summary.addRaw(markdown.replace(COMMENT_MARKER, '')).write();
  } catch (err) {
    core.info(`Could not write the job summary: ${(err as Error).message}`);
  }

  if (commentEnabled && pr && config.comment.enabled) {
    const token = core.getInput('token') || process.env['GITHUB_TOKEN'];
    if (token) {
      try {
        await upsertComment(token, pr['number'] as number, markdown);
      } catch (err) {
        core.info(`Could not post the PR comment (read only token on a fork PR is expected): ${(err as Error).message}`);
      }
    } else {
      core.info('No token: skipping the PR comment. The report is in the job summary and the artifact.');
    }
  }

  core.info(`testwitness: ${report.state} (${report.summary.findings.high} high, ${report.summary.findings.medium} medium, ${report.summary.findings.low} low) in ${report.timing.totalMs} ms`);
  if (exitCode === 1) core.setFailed(`testwitness: review needed (${config.mode} mode, fail_on ${config.failOn})`);
  else if (exitCode === 3) core.setFailed('testwitness: no test results and require_evidence is set');
}

async function upsertComment(token: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const existing = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
  const mine = existing.find((c) => c.body?.includes(COMMENT_MARKER));
  const capped = body.length > 60_000 ? body.slice(0, 60_000) + '\n\n(truncated; see the testwitness.json artifact)' : body;
  if (mine) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: capped });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: capped });
}

export async function readReport(path: string): Promise<Report | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as Report;
}

run().catch((err: Error) => core.setFailed(`testwitness failed: ${err.stack ?? err.message}`));
