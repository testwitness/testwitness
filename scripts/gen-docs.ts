// Generates docs/rules.md from the rule catalogue in code and refreshes the README rule block: the proven rules
// (PROVEN_RULES, the only rules v0.1 reports at medium or high) with their corpus numbers, then every other rule,
// capped at low until it passes an untuned replay.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinRules, GATE_RULES, PROVEN_RULES } from '@testwitness/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = builtinRules();
const proven = (id: string): boolean => PROVEN_RULES.includes(id);
const gate = (id: string): boolean => GATE_RULES.includes(id);

// docs/rules.md
const lines = [
  '# Rules reference',
  '',
  'Generated from the rule definitions in `packages/core/src/rules`. Do not edit by hand; run `pnpm gen:docs`.',
  '',
  `v0.1 reports only the proven rules at medium or high: ${[...PROVEN_RULES].sort().join(', ')}. Every other rule still runs, but its findings are capped at low (informational) until it passes an untuned replay, and the report keeps the severity the rule gave in \`uncappedSeverity\`. W006, the gate protecting itself, is the one exception. The default severity below is what the rule itself says. A repository can opt a rule back in by naming its severity in \`.testwitness.yml\`, for example \`rules: { R001: medium }\`. See [how we measure precision](how-we-measure-precision.md).`,
  '',
];
for (const r of rules) {
  // Angle brackets in prose (XML settings such as <excludes>) would read as HTML tags in the VitePress build.
  const md = (t: string): string => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const status = proven(r.id) ? 'Proven: reported at the severity below.' : gate(r.id) ? 'The gate protecting itself: reported at the severity below, the one exception to the cap.' : 'Not proven yet: reported at low unless the repository opts it in.';
  lines.push(`## ${r.id} ${r.name}`, '', `${status} Default severity: ${r.defaultSeverity}. Since ${r.since}. Languages: ${r.languages === 'any' ? 'all' : r.languages.join(', ')}. Needs: ${r.needs.join(', ')}.`, '', md(r.docs.summary), '', `**False positive controls.** ${md(r.docs.falsePositives)}`, '', '```diff', r.docs.example, '```', '');
}
writeFileSync(join(root, 'docs', 'rules.md'), lines.join('\n'));

// README block from the corpus verdicts (judged at the severity each rule gives before the cap).
interface Verdict { ruleId: string; verdict: string; severity: string; split: string }
const verdictsPath = join(root, 'corpus', 'verdicts.json');
const verdicts: Verdict[] = existsSync(verdictsPath) ? JSON.parse(readFileSync(verdictsPath, 'utf8')) : [];
interface Stats { tp: number; fp: number; hTp: number; hFp: number }
const stats = new Map<string, Stats>();
for (const v of verdicts) {
  const s = stats.get(v.ruleId) ?? { tp: 0, fp: 0, hTp: 0, hFp: 0 };
  const medHigh = v.severity === 'medium' || v.severity === 'high';
  if (v.verdict === 'tp') s.tp++;
  if (v.verdict === 'fp') s.fp++;
  if (v.split === 'heldout' && medHigh && v.verdict === 'tp') s.hTp++;
  if (v.split === 'heldout' && medHigh && v.verdict === 'fp') s.hFp++;
  stats.set(v.ruleId, s);
}
const heldoutPrecision = (s: Stats): number | null => (s.hTp + s.hFp > 0 ? s.hTp / (s.hTp + s.hFp) : null);
const fmt = (x: number | null): string => (x === null ? 'n/a' : x.toFixed(2));
const zero: Stats = { tp: 0, fp: 0, hTp: 0, hFp: 0 };
const table = ['| Rule | Finding | Severity | True positives (corpus) | False positives (medium or high) | Held out precision (medium or high) |', '|---|---|---|---|---|---|'];
for (const r of rules.filter((x) => proven(x.id))) {
  const s = stats.get(r.id) ?? zero;
  table.push(`| ${r.id} | ${r.name} | ${r.defaultSeverity} | ${s.tp} | ${s.fp} | ${fmt(heldoutPrecision(s))} |`);
}
const n = (k: number, w: string): string => `${k} ${w}${k === 1 ? '' : 's'}`;
const capped = rules.filter((r) => !proven(r.id) && !gate(r.id));
const cappedList = capped.map((r) => {
  const s = stats.get(r.id) ?? zero;
  return `- ${r.id} ${r.name} (says ${r.defaultSeverity}): ${s.tp ? `${n(s.tp, 'true positive')}, ${n(s.fp, 'false positive')} on the corpus` : 'no true positive on the corpus yet'}`;
});
const block = [
  '<!-- rules:start -->',
  `v0.1 reports ${PROVEN_RULES.length} rules at medium or high, the proven ones. Their numbers on the public PR corpus ([docs/precision.md](docs/precision.md)):`,
  '',
  ...table,
  '',
  `Every other rule still runs, but its findings are capped at low (informational, collapsed in the comment) until it passes an untuned replay on pull requests from repositories it was never tuned on ([how we measure](docs/how-we-measure-precision.md)). W006, a change to the gate itself, is the one exception and keeps its severity. A repository can opt a rule back in by naming its severity in \`.testwitness.yml\`, for example \`rules: { R001: medium }\`. The severity in brackets is what the rule says before the cap; the corpus counts are judged at that severity:`,
  '',
  ...cappedList,
  '',
  'The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).',
  '<!-- rules:end -->',
].join('\n');
// The recall line of the README: of the true positive labels of the proven rules on the held out half (never used for
// tuning), the share the engine reports at medium or high. A label is found when a verdict is tp at medium or high;
// a tp at low or a miss counts against it. Labels that mark a benign low signal (verdict fp in expected.json) are no
// true positive and are left out.
let found = 0;
let labels = 0;
for (const v of verdicts) {
  if (v.split !== 'heldout' || !proven(v.ruleId)) continue;
  if (v.verdict === 'tp' || v.verdict === 'missed') labels++;
  if (v.verdict === 'tp' && (v.severity === 'medium' || v.severity === 'high')) found++;
}
const recall = [
  '<!-- recall:start -->',
  `Recall: on the weakened pull requests in the held out half of the corpus, which was never used to tune a rule, the four rules report ${found} of their ${labels} true positive labels at medium or high (${labels ? Math.round((100 * found) / labels) : 0}%).`,
  '<!-- recall:end -->',
].join('');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
let updated = readme.includes('<!-- rules:start -->')
  ? readme.replace(/<!-- rules:start -->[\s\S]*<!-- rules:end -->/, block)
  : readme.replace(/## Rules in v0\.1[\s\S]*?(?=\n## Precision)/, `## Rules in v0.1\n\n${block}\n`);
updated = updated.replace(/<!-- recall:start -->[\s\S]*?<!-- recall:end -->/, recall);
writeFileSync(readmePath, updated);
process.stdout.write(`rules.md: ${rules.length} rules; README: ${PROVEN_RULES.length} proven, ${capped.length} capped at low; held out recall of the proven rules ${found} of ${labels}\n`);
