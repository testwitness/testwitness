import { describe, expect, it } from 'vitest';
import { pullRequestFromEvent } from './pull-request.js';

const PR = { number: 7, title: 'Add exemptions', body: '', head: { sha: 'h' }, base: { sha: 'b', ref: 'main' }, user: { login: 'maple' } };

describe('pull request of the event', () => {
  it('takes the pull request from a pull_request payload without calling the API', async () => {
    let calls = 0;
    const pr = await pullRequestFromEvent('pull_request', { pull_request: PR }, async () => {
      calls++;
      return PR;
    });
    expect(pr).toBe(PR);
    expect(calls).toBe(0);
  });

  it('fetches the pull request of an issue_comment on a pull request', async () => {
    const asked: number[] = [];
    const pr = await pullRequestFromEvent('issue_comment', { issue: { number: 7, pull_request: { url: 'x' } }, comment: { body: '/testwitness mutate' } }, async (n) => {
      asked.push(n);
      return PR;
    });
    expect(pr).toEqual(PR);
    expect(asked).toEqual([7]);
  });

  it('returns nothing for a comment on an issue, without a token, or when the API fails, and says why', async () => {
    const logs: string[] = [];
    const log = (s: string) => logs.push(s);
    expect(await pullRequestFromEvent('issue_comment', { issue: { number: 3 } }, async () => PR, log)).toBeUndefined();
    expect(await pullRequestFromEvent('issue_comment', { issue: { number: 7, pull_request: {} } }, undefined, log)).toBeUndefined();
    expect(
      await pullRequestFromEvent('issue_comment', { issue: { number: 7, pull_request: {} } }, async () => {
        throw new Error('Not Found');
      }, log),
    ).toBeUndefined();
    expect(await pullRequestFromEvent('push', {}, async () => PR, log)).toBeUndefined();
    expect(logs).toEqual([expect.stringContaining('without a token'), 'Could not read pull request #7: Not Found']);
  });
});
