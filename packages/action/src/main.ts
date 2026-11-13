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
import { downloadBaseHistory, HISTORY_FILE, isDefaultBranchPush, uploadHistory } from './history.js';
import { pullRequestFromEvent, type EventPayload, type PullRequestPayload } from './pull-request.js';
import { renderJson, renderMarkdown, serializeHistory, COMMENT_MARKER, applyAcknowledgements, parseAckCommands, parseMutateCommand, computeState, exitCodeFor, type Finding, type Report, type PullRequestComment } from '@testwitness/core';

function annotationLevel(f: Finding, strict: boolean): 'error' | 'warning' | 'notice' {
  if (f.severity === 'high') return strict ? 'error' : 'warning';
  if (f.severity === 'medium') return 'warning';
  return 'notice';
}

export async function run(): Promise<void> {
  const cwd = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
  const ctx = github.context;
  const token = core.getInput('token') || process.env['GITHUB_TOKEN'];
  if (ctx.eventName === 'issue_comment' && !parseMutateCommand(String((ctx.payload.comment as { body?: unknown } | undefined)?.body ?? ''))) {
    core.info('testwitness: issue_comment event without a /testwitness mutate command; nothing to do.');
    return;
  }
  const pr = await pullRequestFromEvent(ctx.eventName, ctx.payload as EventPayload, token ? (n) => fetchPullRequest(token, n) : undefined, (s) => core.info(s));
  const baseInput = core.getInput('base');
  const headInput = core.getInput('head');
  const defaultPush = isDefaultBranchPush();
  const head = headInput || (pr ? (pr['head'] as { sha: string }).sha : 'HEAD');
  // A push to the default branch has no pull request to compare; it runs to record history, so the diff is empty.
  const base = baseInput || (pr ? (pr['base'] as { sha: string }).sha : defaultPush ? head : 'origin/main');
  const junit = core.getInput('junit') || undefined;
  const coverage = core.getInput('coverage') || undefined;
  const mutation = core.getInput('mutation') || undefined;
  const mode = (core.getInput('mode') || undefined) as 'report' | 'require-ack' | 'strict' | undefined;
  const failOn = (core.getInput('fail_on') || undefined) as 'high' | 'medium' | 'low' | undefined;
  const configPath = core.getInput('config') || undefined;
  const commentEnabled = (core.getInput('comment') || 'true') !== 'false';
  const outDir = core.getInput('output_dir') || '.';
  const historyInput = core.getInput('history') || undefined;
  const historyArtifact = core.getInput('history_artifact');
  const historyWrite = core.getInput('history_write') === 'true' || defaultPush;

  // PR text comes from the event payload file, read as data.
  let prTitle: string | undefined;
  let prBodyFile: string | undefined;
  if (pr) {
    prTitle = String(pr['title'] ?? '');
    prBodyFile = resolve(cwd, '.testwitness-pr-body.txt');
    await writeFile(prBodyFile, String(pr['body'] ?? ''));
  }

  // Author comes from the payload as data, used for provenance display only.
  const user = pr?.['user'] as { login?: unknown; type?: unknown } | undefined;
  const author = typeof user?.login === 'string' && user.login ? user.login : undefined;
  const authorType = typeof user?.type === 'string' ? user.type : undefined;

  // History: a local file when given, else the artifact of the base branch on pull requests.
  let history: { path: string; source?: string } | undefined = historyInput ? { path: historyInput } : undefined;
  if (!history && pr && historyArtifact) {
    const baseRef = String((pr['base'] as { ref?: unknown } | undefined)?.ref ?? '');
    if (baseRef) history = await downloadBaseHistory(token, historyArtifact, baseRef);
  }

  const { report, config, history: updatedHistory } = await check({
    cwd, base, head, junit, coverage, mutation, mode, failOn, config: configPath, format: 'json', prTitle, prBodyFile, author, authorType, quiet: false,
    history: history?.path, historySource: history?.source, recordHistory: !!historyArtifact || !!historyInput || historyWrite,
  });

  // Acknowledgements from PR comments and the label. Comments are readable on fork PRs with the read only token.
  if (pr && token) {
    try {
      const prAuthor = (pr['user'] as { login?: string } | undefined)?.login;
      const { comments, label } = await readAcknowledgementSources(token, pr['number'] as number);
      applyAcknowledgements(report.findings, parseAckCommands(comments, prAuthor), label);
      report.state = computeState(report.findings, config, undefined, []);
      if (report.evidence.state === 'unreadable' && report.state === 'pass' && report.files.tests > 0) report.state = 'unreadable';
      const counts = { high: 0, medium: 0, low: 0 };
      for (const f of report.findings) if (!f.acknowledged) counts[f.severity]++;
      report.summary.findings = counts;
    } catch (err) {
      core.info(`Could not read PR comments or labels for acknowledgements: ${(err as Error).message}`);
    }
  }
  const exitCode = exitCodeFor(report, config);

  const jsonPath = resolve(cwd, outDir, 'testwitness.json');
  const mdPath = resolve(cwd, outDir, 'testwitness.md');
  const markdown = renderMarkdown(report, { collapseLow: config.comment.collapseLow, marker: true });
  await writeFile(jsonPath, renderJson(report));
  await writeFile(mdPath, markdown);
  core.setOutput('state', report.state);
  core.setOutput('report', jsonPath);
  core.setOutput('findings_high', String(report.summary.findings.high));
  core.setOutput('findings_medium', String(report.summary.findings.medium));
  if (updatedHistory) {
    const historyPath = resolve(cwd, outDir, HISTORY_FILE);
    await writeFile(historyPath, serializeHistory(updatedHistory));
    core.setOutput('history', historyPath);
    if (historyWrite && historyArtifact) await uploadHistory(historyArtifact, historyPath);
    else if (historyWrite) core.info('History: history_artifact is empty, so the history was written but not uploaded.');
  }

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

async function readAcknowledgementSources(token: string, prNumber: number): Promise<{ comments: PullRequestComment[]; label: { present: boolean; by?: string; reason?: string; at?: string } }> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const raw = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
  const comments: PullRequestComment[] = raw.map((c) => ({ author: c.user?.login ?? '', association: c.author_association ?? 'NONE', body: c.body ?? '', createdAt: c.created_at }));
  const labels = await octokit.rest.issues.listLabelsOnIssue({ owner, repo, issue_number: prNumber, per_page: 100 });
  const present = labels.data.some((l) => l.name === 'testwitness:acknowledged');
  if (!present) return { comments, label: { present: false } };
  // Reason: the most recent comment by an owner, member or collaborator.
  const trusted = [...comments].reverse().find((c) => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.association.toUpperCase()));
  return { comments, label: { present: true, ...(trusted ? { by: trusted.author, reason: trusted.body.slice(0, 200), at: trusted.createdAt } : {}) } };
}

async function fetchPullRequest(token: string, prNumber: number): Promise<PullRequestPayload> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  return data as unknown as PullRequestPayload;
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

