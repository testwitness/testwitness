import { describe, expect, it } from 'vitest';
import { detectProvenance } from './provenance.js';

describe('detectProvenance', () => {
  it('finds Claude Code trailers and counts commits', () => {
    const p = detectProvenance(['fix: x\n\nCo-Authored-By: Claude Fable <noreply@anthropic.com>', 'docs', 'feat\n\nClaude-Session: https://claude.ai/code/s']);
    const claude = p.agents.find((a) => a.name === 'Claude Code')!;
    expect(claude.signals).toContain('Co-Authored-By trailer on 1 of 3 commits');
    expect(claude.signals).toContain('Claude-Session trailer on 1 of 3 commits');
  });
  it('finds Cursor, Copilot and Codex', () => {
    const p = detectProvenance(['a\n\nCo-authored-by: Cursor <noreply@cursor.sh>', 'b\n\nCo-authored-by: GitHub Copilot <copilot@github.com>'], { title: 'x', body: 'see https://chatgpt.com/codex/tasks/1' });
    expect(p.agents.map((a) => a.name).sort()).toEqual(['Codex', 'Cursor', 'GitHub Copilot']);
  });
  it('reports bot authors and title tags', () => {
    const p = detectProvenance([], { title: '[Claude] add thing', body: '' }, 'devin-ai-integration[bot]');
    expect(p.botAuthor).toBe('devin-ai-integration[bot]');
    expect(p.agents[0]).toEqual({ name: 'Claude Code', signals: ['[Claude] title tag'] });
  });
  it('returns nothing for plain commits', () => {
    expect(detectProvenance(['fix typo'])).toEqual({ agents: [] });
  });
});
