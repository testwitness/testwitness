/**
 * The pull request a run is about. On `pull_request` events it is in the payload. On `issue_comment` events (the
 * mutation workflow, docs/mutation-on-request.md) the payload only has the issue, so the pull request is fetched
 * through the REST API with the job token; without a token there is none, and the run reads the base and head inputs.
 */
export type PullRequestPayload = { [key: string]: unknown; number: number };

export interface EventPayload {
  pull_request?: PullRequestPayload | undefined;
  issue?: { number?: number; pull_request?: unknown } | undefined;
  comment?: { body?: string } | undefined;
}

export async function pullRequestFromEvent(
  eventName: string,
  payload: EventPayload,
  fetchPullRequest: ((n: number) => Promise<PullRequestPayload>) | undefined,
  log: (s: string) => void = () => {},
): Promise<PullRequestPayload | undefined> {
  if (payload.pull_request) return payload.pull_request;
  if (eventName !== 'issue_comment' || !payload.issue?.pull_request || typeof payload.issue.number !== 'number') return undefined;
  if (!fetchPullRequest) {
    log('issue_comment event without a token: the pull request cannot be read, so the base and head inputs decide what is compared and no comment is posted.');
    return undefined;
  }
  try {
    return await fetchPullRequest(payload.issue.number);
  } catch (err) {
    log(`Could not read pull request #${payload.issue.number}: ${(err as Error).message}`);
    return undefined;
  }
}
