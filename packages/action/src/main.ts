/**
 * GitHub Action entry. Reads inputs from the environment (never from `${{ }}`
 * interpolation into shell), runs the check, writes the JSON and Markdown
 * reports, emits workflow command annotations, and posts or updates one PR
 * comment when the token can write. Works with no token at all.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { check } from 'testwitness';
import { downloadBaseHistory, HISTORY_FILE, isDefaultBranchPush, uploadHistory } from './history.js';
import { emitAnnotations, findOwnComment, info } from './annotations.js';
import { pullRequestFromEvent, type EventPayload, type PullRequestPayload } from './pull-request.js';
import { renderJson, renderMarkdown, writeFileNoFollow, serializeHistory, COMMENT_MARKER, applyAcknowledgements, parseAckCommands, parseMutateCommand, computeState, exitCodeFor, type ChangedFile, type Evidence, type Report, type ResolvedConfig, type PullRequestComment } from '@testwitness/core';

export async function run(): Promise<void> {
  const cwd = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
  const ctx = github.context;
  const token = core.getInput('token') || process.env['GITHUB_TOKEN'];
  if (ctx.eventName === 'issue_comment' && !parseMutateCommand(String((ctx.payload.comment as { body?: unknown } | undefined)?.body ?? ''))) {
    core.info('testwitness: issue_comment event without a /testwitness mutate command; nothing to do.');
    return;
  }
  const pr = await pullRequestFromEvent(ctx.eventName, ctx.payload as EventPayload, token ? (n) => fetchPullRequest(token, n) : undefined, (s) => info(s));
  const baseInput = core.getInput('base');
  const headInput = core.getInput('head');
  const defaultPush = isDefaultBranchPush();
  const head = headInput || (pr ? (pr['head'] as { sha: string }).sha : 'HEAD');
  // A push to the default branch has no pull request to compare; it runs to record history, so the diff is empty.
  const base = baseInput || (pr ? (pr['base'] as { sha: string }).sha : defaultPush ? head : 'origin/main');
  // `results` is the preferred input; `junit` is its older name and carries the default globs.
  const results = core.getInput('results') || undefined;
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

  // PR text comes from the event payload file, read as data. It is handed to the check in memory: it used to be
  // written to .testwitness-pr-body.txt in the checkout, where a link committed under that name would have been
  // written through.
  let prTitle: string | undefined;
  let prBody: string | undefined;
  if (pr) {
    prTitle = String(pr['title'] ?? '');
    prBody = String(pr['body'] ?? '');
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

  const { report, config, history: updatedHistory, files, evidence } = await check({
    cwd, base, head, results, junit, coverage, mutation, mode, failOn, config: configPath, configFromBaseOnly: true, format: 'json', prTitle, prBody, author, authorType, quiet: false,
    // Log lines name files and quote results files of the pull request; they are made safe for the step log.
    log: (s) => info(s),
    history: history?.path, historySource: history?.source, recordHistory: !!historyArtifact || !!historyInput || historyWrite,
  });

  // Acknowledgements from PR comments and the label. Comments are readable on fork PRs with the read only token.
  if (pr && token) {
    try {
      const prAuthor = (pr['user'] as { login?: string } | undefined)?.login;
      const { comments, label } = await readAcknowledgementSources(token, pr['number'] as number, prAuthor);
      applyAcknowledgements(report.findings, parseAckCommands(comments, prAuthor), label);
      recomputeAfterAcknowledgements(report, config, files, evidence);
    } catch (err) {
      info(`Could not read PR comments or labels for acknowledgements: ${(err as Error).message}`);
    }
  }
  const exitCode = exitCodeFor(report, config);

  const jsonPath = resolve(cwd, outDir, 'testwitness.json');
  const mdPath = resolve(cwd, outDir, 'testwitness.md');
  const markdown = renderMarkdown(report, { collapseLow: config.comment.collapseLow, marker: true });
  // The checkout belongs to the pull request: never write through a link it committed at an output path.
  await writeFileNoFollow(jsonPath, renderJson(report));
  await writeFileNoFollow(mdPath, markdown);
  core.setOutput('state', report.state);
  core.setOutput('report', jsonPath);
  core.setOutput('findings_high', String(report.summary.findings.high));
  core.setOutput('findings_medium', String(report.summary.findings.medium));
  if (updatedHistory) {
    const historyPath = resolve(cwd, outDir, HISTORY_FILE);
    await writeFileNoFollow(historyPath, serializeHistory(updatedHistory));
    core.setOutput('history', historyPath);
    if (historyWrite && historyArtifact) await uploadHistory(historyArtifact, historyPath);
    else if (historyWrite) core.info('History: history_artifact is empty, so the history was written but not uploaded.');
  }

  // Annotations render on the Files tab without any token.
  emitAnnotations(report.findings, config.mode === 'strict');

  try {
    await core.summary.addRaw(markdown.replace(COMMENT_MARKER, '')).write();
  } catch (err) {
    info(`Could not write the job summary: ${(err as Error).message}`);
  }

  if (commentEnabled && pr && config.comment.enabled) {
    if (token) {
      try {
        await upsertComment(token, pr['number'] as number, markdown);
      } catch (err) {
        info(`Could not post the PR comment (read only token on a fork PR is expected): ${(err as Error).message}`);
      }
    } else {
      core.info('No token: skipping the PR comment. The report is in the job summary and the artifact.');
    }
  }

  core.info(`testwitness: ${report.state} (${report.summary.findings.high} high, ${report.summary.findings.medium} medium, ${report.summary.findings.low} low) in ${report.timing.totalMs} ms`);
  if (exitCode === 1) core.setFailed(`testwitness: review needed (${config.mode} mode, fail_on ${config.failOn})`);
  else if (exitCode === 3) core.setFailed('testwitness: no test results and require_evidence is set');
}

/**
 * State and counts after acknowledgements changed findings, from the same inputs the engine graded with: the evidence
 * and the changed files, so a pull request that touches only runner config or a workflow and has no results stays
 * unreadable (exit code 3 under strict with require_evidence) instead of turning into a pass.
 */
export function recomputeAfterAcknowledgements(report: Report, config: ResolvedConfig, files: ChangedFile[], evidence: Evidence | undefined): void {
  report.state = computeState(report.findings, config, evidence, files);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of report.findings) if (!f.acknowledged) counts[f.severity]++;
  report.summary.findings = counts;
}

async function readAcknowledgementSources(token: string, prNumber: number, prAuthor: string | undefined): Promise<{ comments: PullRequestComment[]; label: { present: boolean; by?: string; reason?: string; at?: string } }> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const raw = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
  const comments = await withWriteAccessOnly(
    raw.map((c) => ({ author: c.user?.login ?? '', association: c.author_association ?? 'NONE', body: c.body ?? '', createdAt: c.created_at })),
    async (login) => (await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login })).data.permission,
    (s) => info(s),
  );
  const labels = await octokit.rest.issues.listLabelsOnIssue({ owner, repo, issue_number: prNumber, per_page: 100 });
  const present = labels.data.some((l) => l.name === ACK_LABEL);
  if (!present) return { comments, label: { present: false } };
  // Who applied the label, from the issue events. Any failure to read them means the label is ignored.
  let actor: { login: string; at: string } | undefined;
  try {
    const events = await octokit.paginate(octokit.rest.issues.listEvents, { owner, repo, issue_number: prNumber, per_page: 100 });
    actor = await trustedLabelActor(events as LabelEvent[], prAuthor, async (login) => (await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login })).data.permission);
  } catch (err) {
    info(`Could not read who applied the ${ACK_LABEL} label, so it is ignored: ${(err as Error).message}`);
    return { comments, label: { present: false } };
  }
  if (!actor) {
    core.info(`The ${ACK_LABEL} label was not applied by a maintainer other than the pull request author, so it is ignored.`);
    return { comments, label: { present: false } };
  }
  // Reason: the labeller's most recent comment, else the label itself.
  const said = [...comments].reverse().find((c) => c.author.toLowerCase() === actor!.login.toLowerCase());
  return { comments, label: { present: true, by: actor.login, at: actor.at, ...(said ? { reason: said.body.slice(0, 200) } : {}) } };
}

export const ACK_LABEL = 'testwitness:acknowledged';

/**
 * Comments whose acknowledgement commands may count. The comment's author_association is not enough: MEMBER is any
 * member of the organisation, with or without access to this repository, and COLLABORATOR includes people invited
 * with read access. An acknowledgement needs write or admin permission on the repository, as the label does, so the
 * permission of everyone who wrote a `/testwitness ack` command is looked up, and a commenter without it (or whose
 * lookup fails) is treated as an outsider. Comments without a command are passed through untouched.
 */
export async function withWriteAccessOnly(comments: PullRequestComment[], permissionOf: (login: string) => Promise<string>, log: (s: string) => void = () => {}): Promise<PullRequestComment[]> {
  const verdict = new Map<string, boolean>();
  const out: PullRequestComment[] = [];
  for (const c of comments) {
    if (!/^[^\S\r\n\u2028\u2029]*\/testwitness\s+ack\b/im.test(c.body) || !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.association.toUpperCase())) {
      out.push(c);
      continue;
    }
    const key = c.author.toLowerCase();
    if (!verdict.has(key)) {
      let ok = false;
      try {
        ok = ['admin', 'write'].includes(await permissionOf(c.author));
        if (!ok) log(`The acknowledgement by ${c.author} is ignored: no write access to this repository.`);
      } catch (err) {
        log(`Could not read the permission of ${c.author}, so the acknowledgement is ignored: ${(err as Error).message}`);
      }
      verdict.set(key, ok);
    }
    out.push(verdict.get(key) ? c : { ...c, association: 'NONE' });
  }
  return out;
}

export interface LabelEvent {
  event?: string;
  label?: { name?: string } | null;
  actor?: { login?: string } | null;
  created_at?: string;
}

/**
 * The person whose application of the acknowledgement label counts: the actor of the most recent `labeled` event for
 * it, when that actor is not the pull request author and has write or admin permission on the repository (owners,
 * members and collaborators with write). Undefined otherwise: then the label is ignored. A failing permission lookup
 * throws, and the caller ignores the label.
 */
export async function trustedLabelActor(events: LabelEvent[], prAuthor: string | undefined, permissionOf: (login: string) => Promise<string>): Promise<{ login: string; at: string } | undefined> {
  const last = [...events].reverse().find((e) => e.event === 'labeled' && e.label?.name === ACK_LABEL);
  const login = last?.actor?.login;
  if (!login) return undefined;
  if (prAuthor && login.toLowerCase() === prAuthor.toLowerCase()) return undefined;
  const permission = await permissionOf(login);
  return ['admin', 'write'].includes(permission) ? { login, at: last?.created_at ?? '' } : undefined;
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
  const mine = findOwnComment(existing, COMMENT_MARKER);
  const capped = body.length > 60_000 ? body.slice(0, 60_000) + '\n\n(truncated; see the testwitness.json artifact)' : body;
  if (mine) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: capped });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: capped });
}

export async function readReport(path: string): Promise<Report | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as Report;
}

