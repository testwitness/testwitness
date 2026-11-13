// The mutation workflow template (docs/workflows/testwitness-mutate.yml) is the one place where code from a pull request
// runs. These checks keep its gates in place when someone edits it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const text = readFileSync(join(root, 'docs/workflows/testwitness-mutate.yml'), 'utf8');
interface Step { uses?: string; run?: string; with?: Record<string, unknown>; id?: string }
interface Job { if?: string; permissions?: Record<string, string>; steps: Step[]; needs?: string | string[] }
const wf = parse(text) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };

describe('mutation workflow template', () => {
  it('starts only on issue comments, with no default permissions', () => {
    expect(Object.keys(wf.on)).toEqual(['issue_comment']);
    expect(wf.permissions).toEqual({});
    expect(Object.keys(wf.jobs)).toEqual(['gate', 'mutate', 'report']);
  });

  it('gates on a pull request comment, the commenter write permission and, for forks, a reviewed head sha', () => {
    const gate = wf.jobs['gate']!;
    expect(gate.if).toContain('github.event.issue.pull_request');
    expect(gate.permissions).toEqual({ 'pull-requests': 'read' });
    const script = String(gate.steps[0]!.with!['script']);
    expect(script).toContain('getCollaboratorPermissionLevel');
    expect(script).toMatch(/\['admin', 'write'\]\.includes\(level\.permission\)/);
    // A 7 character prefix is 28 bits: a fork can grind a commit that matches it and push it after the review.
    expect(script).toMatch(/fork && \(!wanted\.sha \|\| wanted\.sha\.length < 12\)/);
    expect(script).toMatch(/!pr\.head\.sha\.startsWith\(wanted\.sha\)/);
  });

  it('runs the code in a job with a read only token, the gated head, no persisted credentials, no cache and no secrets', () => {
    const mutate = wf.jobs['mutate']!;
    expect(mutate.needs).toBe('gate');
    expect(mutate.permissions).toEqual({ contents: 'read' });
    const checkout = mutate.steps.find((s) => s.uses?.startsWith('actions/checkout@'))!;
    expect(checkout.with).toMatchObject({ ref: '${{ needs.gate.outputs.head }}', 'persist-credentials': false });
    for (const s of mutate.steps) {
      expect(s.uses ?? '').not.toMatch(/^actions\/cache@/);
      expect(s.with?.['cache']).toBeUndefined();
    }
    expect(text).not.toContain('secrets.');
  });

  it('never puts comment text into a shell, and comments from a job that runs no pull request code', () => {
    for (const job of Object.values(wf.jobs)) for (const s of job.steps) expect(s.run ?? '').not.toContain('github.event');
    const report = wf.jobs['report']!;
    expect(report.steps.every((s) => s.run === undefined)).toBe(true);
    const action = report.steps.find((s) => s.uses?.startsWith('testwitness/testwitness@'))!;
    expect(action.with).toMatchObject({ base: '${{ needs.gate.outputs.base }}', head: '${{ needs.gate.outputs.head }}' });
    expect(String(action.with!['mutation'])).toContain('testwitness-mutation');
    expect(report.steps.some((s) => s.uses === './')).toBe(false);
  });
});
