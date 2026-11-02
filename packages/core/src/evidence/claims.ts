/**
 * Claims in PR text. Deterministic phrase matching; each claim is later
 * classified supported, unsupported or unreadable against the evidence.
 * Wording in findings is always "not supported by the results attached to
 * this run", never "false".
 */
export type ClaimKind = 'tests-pass' | 'ci-green' | 'verified' | 'tested-locally' | 'full-coverage' | 'added-tests' | 'no-test-changes' | 'ran-suite';

export interface Claim {
  kind: ClaimKind;
  /** The matched text, trimmed, at most 80 characters. */
  text: string;
}

const PATTERNS: Array<{ kind: ClaimKind; re: RegExp }> = [
  { kind: 'tests-pass', re: /\b(all\s+)?(unit\s+|integration\s+|e2e\s+)?tests?\s+(are\s+|is\s+|now\s+)?(pass(es|ing|ed)?|green)\b/i },
  { kind: 'tests-pass', re: /\ball\s+green\b/i },
  { kind: 'ci-green', re: /\bci\s+(is\s+)?(green|passing|passes)\b/i },
  { kind: 'verified', re: /\b(verified|validated)\b(?!\s+by)/i },
  { kind: 'tested-locally', re: /\btested\s+(locally|manually|on my machine)\b/i },
  { kind: 'full-coverage', re: /\b100\s*%\s*(test\s+)?coverage\b/i },
  { kind: 'added-tests', re: /\b(add(ed|s)?|wrote|new|includes?)\s+(unit\s+|integration\s+|e2e\s+|regression\s+)?tests?\b/i },
  { kind: 'no-test-changes', re: /\bno\s+test\s+changes?\b/i },
  { kind: 'ran-suite', re: /\bran\s+(the\s+)?(full\s+|whole\s+|entire\s+)?(test\s+)?suite\b/i },
  { kind: 'tests-pass', re: /\bfully\s+tested\b/i },
];

/** Strip fenced code, inline code and HTML comments so claims inside code or templates are not counted. */
export function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*-\s*\[\s*\]\s.*$/gm, ' '); // unchecked checklist items are not claims
}

export function findClaims(text: string, extraPhrases: string[] = []): Claim[] {
  const prose = stripNonProse(text);
  const out: Claim[] = [];
  const seen = new Set<string>();
  const add = (kind: ClaimKind, m: RegExpMatchArray) => {
    const t = m[0].trim().slice(0, 80);
    const key = `${kind}:${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text: t });
  };
  for (const { kind, re } of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of prose.matchAll(g)) {
      // "no tests pass" style negations
      const before = prose.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
      if (/\b(not?|never|without|don'?t|doesn'?t|didn'?t)\s*$/i.test(before)) continue;
      add(kind, m);
    }
  }
  for (const p of extraPhrases) {
    const idx = prose.toLowerCase().indexOf(p.toLowerCase());
    if (idx >= 0) out.push({ kind: 'tests-pass', text: p });
  }
  return out;
}
