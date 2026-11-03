import { describe, expect, it } from 'vitest';
import { applyAcknowledgements, parseAckCommands } from './acknowledge.js';
import type { Finding } from './types.js';

const f = (ruleId: string, subject: string): Finding => ({ ruleId, severity: 'high', message: '', location: { path: 'a' }, fingerprint: `${ruleId}:a:${subject}`, subject });
const c = (author: string, association: string, body: string) => ({ author, association, body, createdAt: '2026-11-03T00:00:00Z' });

describe('parseAckCommands', () => {
  it('parses rule, subject and reason, and marks trust by association and author', () => {
    const cmds = parseAckCommands([c('lead', 'MEMBER', 'LGTM\n/testwitness ack R003 PaymentsIT#pollsSettlement reason: needs live sandbox, see PAY-412'), c('author', 'CONTRIBUTOR', '/testwitness ack all reason: trust me')], 'author');
    expect(cmds).toEqual([
      { ruleId: 'R003', subject: 'PaymentsIT#pollsSettlement', reason: 'needs live sandbox, see PAY-412', by: 'lead', at: '2026-11-03T00:00:00Z', trusted: true },
      { ruleId: 'all', reason: 'trust me', by: 'author', at: '2026-11-03T00:00:00Z', trusted: false },
    ]);
  });
  it('requires a reason and ignores the PR author even when a member', () => {
    expect(parseAckCommands([c('lead', 'OWNER', '/testwitness ack R003 x')], undefined)).toEqual([]);
    expect(parseAckCommands([c('me', 'OWNER', '/testwitness ack R003 x reason: y')], 'me')[0]!.trusted).toBe(false);
  });
});

describe('applyAcknowledgements', () => {
  it('acknowledges by rule and subject tail, by all, and by label except maintainer only rules', () => {
    const findings = [f('R003', 'PaymentsIT#pollsSettlement'), f('A001', 'CartTest#sums'), f('W006', '.testwitness.yml')];
    applyAcknowledgements(findings, parseAckCommands([c('lead', 'MEMBER', '/testwitness ack R003 pollsSettlement reason: PAY-412')], 'author'), { present: true, by: 'triager' });
    expect(findings[0]!.acknowledged).toMatchObject({ via: 'comment', by: 'lead', reason: 'PAY-412' });
    expect(findings[1]!.acknowledged).toMatchObject({ via: 'label', by: 'triager' });
    expect(findings[2]!.acknowledged).toBeUndefined();
    applyAcknowledgements(findings, parseAckCommands([c('lead', 'OWNER', '/testwitness ack all reason: test only refactor')], 'author'));
    expect(findings[2]!.acknowledged).toMatchObject({ via: 'comment' });
  });
  it('ignores untrusted commands', () => {
    const findings = [f('R003', 'x')];
    applyAcknowledgements(findings, parseAckCommands([c('author', 'OWNER', '/testwitness ack all reason: mine')], 'author'));
    expect(findings[0]!.acknowledged).toBeUndefined();
  });
});
