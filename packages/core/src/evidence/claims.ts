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

/**
 * Checked checklist items too. A PR template's "- [x] Add test case(s)" ticks a reminder; it is template text, not a
 * statement about what this diff does to its tests, so "added tests" claims come from a checklist line only when the
 * caller asks (V004 does when the PR changes no test file).
 */
export function stripChecklist(prose: string): string {
  return prose.replace(/^\s*(?:[-*+]|\d+[.)])?\s*\[[ xX]?\]\s.*$/gm, ' ');
}

/** Words on the same line that cancel an "added tests" claim: "Added tests: not applicable", "no new test". */
const LINE_NEGATION = /\b(no\s+new\s+tests?|no\s+tests?\s+(added|needed|required)|not\s+applicable|n\/a|not\s+needed|none\s+needed)\b/i;

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

/**
 * `checklistClaims`: read "added tests" claims from ticked checklist lines too. V004 sets it only when the PR changes
 * no test file at all, so a ticked "I have added tests" box on a PR that touches no test is still checked.
 */
export function findClaims(text: string, extraPhrases: string[] = [], options: { checklistClaims?: boolean } = {}): Claim[] {
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
  const noChecklist = options.checklistClaims ? prose : stripChecklist(prose);
  for (const { kind, re } of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const source = kind === 'added-tests' ? noChecklist : prose;
    for (const m of source.matchAll(g)) {
      // "no tests pass" style negations
      const before = source.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
      if (/\b(not?|never|without|don'?t|doesn'?t|didn'?t)\s*$/i.test(before)) continue;
      if (kind === 'added-tests' && LINE_NEGATION.test(lineAround(source, m.index ?? 0))) continue;
      add(kind, m);
    }
  }
  for (const p of extraPhrases) {
    const idx = prose.toLowerCase().indexOf(p.toLowerCase());
    if (idx >= 0) out.push({ kind: 'tests-pass', text: p });
  }
  return out;
}
