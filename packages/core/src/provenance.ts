import type { ProvenanceInfo, PullRequestText } from './types.js';

interface Signal {
  agent: string;
  pattern: RegExp;
  label: string;
}

const COMMIT_SIGNALS: Signal[] = [
  { agent: 'Claude Code', pattern: /^co-authored-by:.*(claude|anthropic)/im, label: 'Co-Authored-By trailer' },
  { agent: 'Claude Code', pattern: /^claude-session:/im, label: 'Claude-Session trailer' },
  { agent: 'Claude Code', pattern: /generated with \[?claude code/i, label: 'Generated with Claude Code footer' },
  { agent: 'Cursor', pattern: /^co-authored-by:.*cursor/im, label: 'Co-authored-by trailer' },
  { agent: 'GitHub Copilot', pattern: /^co-authored-by:.*copilot/im, label: 'Co-authored-by trailer' },
  { agent: 'Codex', pattern: /^co-authored-by:.*codex/im, label: 'Co-authored-by trailer' },
  { agent: 'Codex', pattern: /chatgpt\.com\/codex/i, label: 'Codex task link' },
  { agent: 'Devin', pattern: /^co-authored-by:.*devin/im, label: 'Co-authored-by trailer' },
  { agent: 'Aider', pattern: /\(aider\)/i, label: 'aider commit marker' },
  { agent: 'Gemini', pattern: /^co-authored-by:.*(gemini|jules)/im, label: 'Co-authored-by trailer' },
];

const BOT_AUTHORS = ['copilot-swe-agent[bot]', 'devin-ai-integration[bot]', 'cursor[bot]', 'google-labs-jules[bot]', 'dependabot[bot]', 'renovate[bot]'];

/** Detect agent provenance from commit messages and PR text. Shown, never used to change rules. */
export function detectProvenance(commitMessages: string[], pr?: PullRequestText, author?: string): ProvenanceInfo {
  const agents = new Map<string, Set<string>>();
  const add = (agent: string, signal: string) => {
    const s = agents.get(agent) ?? new Set<string>();
    s.add(signal);
    agents.set(agent, s);
  };
  const total = commitMessages.length;
  for (const sig of COMMIT_SIGNALS) {
    const n = commitMessages.filter((m) => sig.pattern.test(m)).length;
    if (n > 0) add(sig.agent, `${sig.label} on ${n} of ${total} commit${total === 1 ? '' : 's'}`);
  }
  if (pr) {
    const text = `${pr.title}\n${pr.body}`;
    for (const sig of COMMIT_SIGNALS) {
      if (sig.pattern.test(text)) add(sig.agent, `${sig.label} in PR text`);
    }
    for (const tag of ['Claude', 'Cursor', 'Copilot', 'Codex', 'Devin']) {
      if (new RegExp(`\\[${tag}\\]`, 'i').test(pr.title)) add(tag === 'Claude' ? 'Claude Code' : tag === 'Copilot' ? 'GitHub Copilot' : tag, `[${tag}] title tag`);
    }
  }
  const info: ProvenanceInfo = { agents: [...agents.entries()].map(([name, signals]) => ({ name, signals: [...signals] })) };
  if (author && BOT_AUTHORS.includes(author)) info.botAuthor = author;
  return info;
}
