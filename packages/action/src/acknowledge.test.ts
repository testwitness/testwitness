// Review decisions 6 and 7: the state after acknowledgements, and who may acknowledge with the label.
import { describe, expect, it } from 'vitest';
import { defaultConfig, exitCodeFor, parseAckCommands, type ChangedFile, type PullRequestComment, type Report } from '@testwitness/core';
import { recomputeAfterAcknowledgements, trustedLabelActor, withWriteAccessOnly, type LabelEvent } from './main.js';

function report(): Report {
  return { state: 'unreadable', findings: [], summary: { findings: { high: 0, medium: 0, low: 0 } }, evidence: { state: 'unreadable' }, files: { tests: 0 } } as unknown as Report;
}

describe('state after acknowledgements', () => {
  it('keeps a runner config only change without results unreadable, so strict with require_evidence still exits 3', () => {
    const config = { ...defaultConfig(), mode: 'strict' as const, requireEvidence: true };
    const files = [{ path: 'vitest.config.ts', kind: 'runner-config', status: 'modified' }] as unknown as ChangedFile[];
    const r = report();
    recomputeAfterAcknowledgements(r, config, files, undefined);
    expect(r.state).toBe('unreadable');
    expect(exitCodeFor(r, config)).toBe(3);
    // What the old recompute (no evidence, no files) produced: a pass and exit 0.
    const old = report();
    recomputeAfterAcknowledgements(old, config, [], undefined);
    expect(exitCodeFor(old, config)).toBe(0);
  });
});

describe('who applied the acknowledgement label', () => {
  const labeled = (login: string, name = 'testwitness:acknowledged', at = '2026-11-04T10:00:00Z'): LabelEvent => ({ event: 'labeled', label: { name }, actor: { login }, created_at: at });
  const perms: Record<string, string> = { maple: 'admin', river: 'write', ash: 'read', author: 'write' };
  const permissionOf = async (login: string) => perms[login] ?? 'none';

  it('honours the latest labeller with write or admin who is not the author', async () => {
    expect(await trustedLabelActor([labeled('ash'), labeled('river', undefined, '2026-11-04T11:00:00Z')], 'author', permissionOf)).toEqual({ login: 'river', at: '2026-11-04T11:00:00Z' });
    expect(await trustedLabelActor([labeled('maple'), { event: 'labeled', label: { name: 'bug' }, actor: { login: 'ash' } }], 'author', permissionOf)).toMatchObject({ login: 'maple' });
  });

  it('ignores the label from the pull request author, a triage or read user, or no labeled event', async () => {
    expect(await trustedLabelActor([labeled('Author')], 'author', permissionOf)).toBeUndefined();
    expect(await trustedLabelActor([labeled('river'), labeled('ash')], 'author', permissionOf)).toBeUndefined();
    expect(await trustedLabelActor([], 'author', permissionOf)).toBeUndefined();
  });

  it('lets a failed permission lookup throw, so the caller ignores the label', async () => {
    await expect(trustedLabelActor([labeled('river')], 'author', async () => { throw new Error('403'); })).rejects.toThrow('403');
  });
});

describe('withWriteAccessOnly', () => {
  const comment = (author: string, association: string, body: string): PullRequestComment => ({ author, association, body, createdAt: '2026-11-13T00:00:00Z' });

  it('an organisation member or a read only collaborator without write access cannot acknowledge', async () => {
    const asked: string[] = [];
    const permissions: Record<string, string> = { maintainer: 'write', owner: 'admin', orgmember: 'read', reader: 'triage' };
    const out = await withWriteAccessOnly(
      [
        comment('maintainer', 'MEMBER', '/testwitness ack R001 reason: moved'),
        comment('orgmember', 'MEMBER', 'looks fine\n/testwitness ack all reason: trust me'),
        comment('reader', 'COLLABORATOR', '/testwitness ack W006 reason: ok'),
        comment('owner', 'OWNER', '  /TESTWITNESS ACK all reason: reviewed'),
        comment('orgmember', 'MEMBER', '/testwitness ack R003 reason: again'),
        comment('orgmember', 'MEMBER', 'no command here'),
        comment('stranger', 'NONE', '/testwitness ack all reason: please'),
      ],
      async (login) => {
        asked.push(login);
        return permissions[login] ?? 'none';
      },
    );
    expect(out.map((c) => c.association)).toEqual(['MEMBER', 'NONE', 'NONE', 'OWNER', 'NONE', 'MEMBER', 'NONE']);
    // One lookup per commenter with a command; none for a stranger, whose command never counted.
    expect(asked).toEqual(['maintainer', 'orgmember', 'reader', 'owner']);
    const commands = parseAckCommands(out, 'author');
    expect(commands.filter((c) => c.trusted).map((c) => c.by)).toEqual(['maintainer', 'owner']);
  });

  it('a failed permission lookup ignores the acknowledgement', async () => {
    const logs: string[] = [];
    const out = await withWriteAccessOnly([comment('maintainer', 'MEMBER', '/testwitness ack all reason: x')], () => Promise.reject(new Error('403')), (s) => logs.push(s));
    expect(out[0]!.association).toBe('NONE');
    expect(logs.join('\n')).toMatch(/Could not read the permission of maintainer/);
  });

  it('reads a comment of blank lines or line separators in linear time', async () => {
    const t0 = performance.now();
    for (const filler of ['\n', '\u2028']) await withWriteAccessOnly([comment('maintainer', 'MEMBER', filler.repeat(100_000))], async () => 'write');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
