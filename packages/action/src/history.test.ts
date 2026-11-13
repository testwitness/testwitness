import { describe, expect, it } from 'vitest';
import { isTrustedHistoryRun } from './history.js';

// Review regression: listWorkflowRuns({ branch: 'main' }) also returns pull_request runs from a fork whose branch is
// named main, and such a run uses the pull request's own workflow file, so it can upload a forged history artifact.
describe('history artifact source', () => {
  const repo = { full_name: 'acme-widgets/ledger-core' };
  it('reads push, schedule and dispatch runs of this repository', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch']) expect(isTrustedHistoryRun({ event, head_repository: repo }, 'acme-widgets', 'ledger-core')).toBe(true);
  });
  it('never reads a pull request run, even one whose head branch is main', () => {
    for (const event of ['pull_request', 'pull_request_target', 'issue_comment', 'workflow_run']) expect(isTrustedHistoryRun({ event, head_repository: repo }, 'acme-widgets', 'ledger-core')).toBe(false);
  });
  it('never reads a run whose head is another repository', () => {
    expect(isTrustedHistoryRun({ event: 'push', head_repository: { full_name: 'mallory/ledger-core' } }, 'acme-widgets', 'ledger-core')).toBe(false);
    expect(isTrustedHistoryRun({ event: 'push', head_repository: null }, 'acme-widgets', 'ledger-core')).toBe(false);
  });
});
