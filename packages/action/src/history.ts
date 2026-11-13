/**
 * Run history in the Action (docs/history.md). On pull_request, download the history artifact from the latest
 * successful run of the same workflow on the base branch, through the REST API with the job token (needs
 * `actions: read`). On push to the default branch, or with `history_write: true`, upload the updated history as an
 * artifact kept 90 days. Every step fails soft: no token, no permission, no earlier run or an expired artifact only
 * means this run grades without history.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** File name of the history inside the artifact. */
export const HISTORY_FILE = 'testwitness-history.json';
/** Successful runs on the base branch to look through for the artifact, newest first. */
const RUNS_TO_SEARCH = 5;

export interface DownloadedHistory {
  path: string;
  /** For the report: artifact name and the run it came from. */
  source: string;
}

/** Find and download the history artifact of the base branch. Returns undefined, after an info line, when there is none. */
export async function downloadBaseHistory(token: string | undefined, artifactName: string, baseRef: string): Promise<DownloadedHistory | undefined> {
  if (!token) {
    core.info(`History: no token, so the ${artifactName} artifact of ${baseRef} was not read. Severities do not use earlier runs.`);
    return undefined;
  }
  const runId = github.context.runId;
  if (!runId) {
    core.info('History: GITHUB_RUN_ID is not set, so the workflow of this run is unknown. Severities do not use earlier runs.');
    return undefined;
  }
  try {
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const { data: current } = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
    const { data: runs } = await octokit.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: current.workflow_id, branch: baseRef, status: 'success', per_page: RUNS_TO_SEARCH });
    for (const run of runs.workflow_runs) {
      if (run.id === runId) continue;
      const { data: arts } = await octokit.rest.actions.listWorkflowRunArtifacts({ owner, repo, run_id: run.id, name: artifactName, per_page: 10 });
      const art = arts.artifacts.find((a) => a.name === artifactName && !a.expired);
      if (!art) continue;
      const dest = mkdtempSync(join(tmpdir(), 'testwitness-history-'));
      const client = new DefaultArtifactClient();
      const res = await client.downloadArtifact(art.id, { path: dest, findBy: { token, workflowRunId: run.id, repositoryOwner: owner, repositoryName: repo } });
      const dir = res.downloadPath ?? dest;
      const file = existsSync(join(dir, HISTORY_FILE)) ? join(dir, HISTORY_FILE) : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f))[0];
      if (!file) {
        core.info(`History: the ${artifactName} artifact of run ${run.id} holds no JSON file. Severities do not use earlier runs.`);
        return undefined;
      }
      core.info(`History: read the ${artifactName} artifact of run ${run.id} on ${baseRef}.`);
      return { path: file, source: `${artifactName} artifact of run ${run.id} on ${baseRef}` };
    }
    core.info(`History: no ${artifactName} artifact on the last ${RUNS_TO_SEARCH} successful runs of this workflow on ${baseRef}. Severities do not use earlier runs; a push to ${baseRef} will start the history.`);
  } catch (err) {
    core.info(`History: could not read the ${artifactName} artifact of ${baseRef} (the token needs actions: read; fork pull requests may not have it): ${(err as Error).message}. Severities do not use earlier runs.`);
  }
  return undefined;
}

/** True on a push to the repository's default branch. */
export function isDefaultBranchPush(): boolean {
  const ctx = github.context;
  if (ctx.eventName !== 'push') return false;
  const def = (ctx.payload.repository as { default_branch?: string } | undefined)?.default_branch;
  return !!def && ctx.ref === `refs/heads/${def}`;
}

/** Upload the history file as an artifact kept 90 days. Fails soft. */
export async function uploadHistory(artifactName: string, file: string): Promise<boolean> {
  try {
    const client = new DefaultArtifactClient();
    const res = await client.uploadArtifact(artifactName, [file], dirname(file), { retentionDays: 90 });
    core.info(`History: uploaded ${basename(file)} as the ${artifactName} artifact (id ${res.id ?? 'unknown'}, kept 90 days).`);
    return true;
  } catch (err) {
    core.info(`History: could not upload the ${artifactName} artifact: ${(err as Error).message}`);
    return false;
  }
}
