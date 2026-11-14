// Generates docs/rules.md from the rule catalogue in code and refreshes the README rule table
// so that it lists only rules with measured true positives on the corpus (plus a pointer to the rest).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinRules } from '@testwitness/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = builtinRules();

// docs/rules.md
const lines = ['# Rules reference', '', 'Generated from the rule definitions in `packages/core/src/rules`. Do not edit by hand; run `pnpm gen:docs`.', ''];
for (const r of rules) {
  // Angle brackets in prose (XML settings such as <excludes>) would read as HTML tags in the VitePress build.
  const md = (t: string): string => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  lines.push(`## ${r.id} ${r.name}`, '', `Default severity: ${r.defaultSeverity}. Since ${r.since}. Languages: ${r.languages === 'any' ? 'all' : r.languages.join(', ')}. Needs: ${r.needs.join(', ')}.`, '', md(r.docs.summary), '', `**False positive controls.** ${md(r.docs.falsePositives)}`, '', '```diff', r.docs.example, '```', '');
}
writeFileSync(join(root, 'docs', 'rules.md'), lines.join('\n'));

// README table from corpus verdicts. A rule gets a headline precision number only when it is promoted:
// at least PROMOTE_MIN_TP engine confirmed true positives in the corpus and at least PROMOTE_MIN_PRECISION
// precision on medium and high findings on the held out half.
interface Verdict { ruleId: string; verdict: string; severity: string; split: string }
const PROMOTE_MIN_TP = 10;
const PROMOTE_MIN_PRECISION = 0.9;
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
const promotedRule = (s: Stats | undefined): boolean => {
  if (!s || s.tp < PROMOTE_MIN_TP) return false;
  const hp = heldoutPrecision(s);
  return hp !== null && hp >= PROMOTE_MIN_PRECISION;
};
const promoted = rules.filter((r) => promotedRule(stats.get(r.id)));
const notPromoted = rules.filter((r) => (stats.get(r.id)?.tp ?? 0) > 0 && !promotedRule(stats.get(r.id)));
const unmeasured = rules.filter((r) => (stats.get(r.id)?.tp ?? 0) === 0);
const table = ['| Rule | Finding | Default | True positives | False positives (medium or high) | Precision | Held out precision (medium or high) |', '|---|---|---|---|---|---|---|'];
for (const r of promoted) {
  const s = stats.get(r.id)!;
  table.push(`| ${r.id} | ${r.name} | ${r.defaultSeverity} | ${s.tp} | ${s.fp} | ${(s.tp / (s.tp + s.fp)).toFixed(2)} | ${fmt(heldoutPrecision(s))} |`);
}
const notPromotedList = notPromoted.map((r) => {
  const s = stats.get(r.id)!;
  const n = (k: number, w: string): string => `${k} ${w}${k === 1 ? '' : 's'}`;
  return `- ${r.id} ${r.name}: ${n(s.tp, 'true positive')}, ${n(s.fp, 'false positive')}, held out precision ${fmt(heldoutPrecision(s))}`;
});
const block = [
  '<!-- rules:start -->',
  `A rule shows a precision number only when the engine confirmed at least ${PROMOTE_MIN_TP} true positives for it on the public PR corpus and its precision on medium and high findings on the held out half is at least ${PROMOTE_MIN_PRECISION} (see [docs/precision.md](docs/precision.md)).`,
  '',
  ...(promoted.length ? table : ['No rule meets that bar yet.']),
  '',
  ...(notPromoted.length ? ['Measured, not yet promoted (no headline number):', '', ...notPromotedList, ''] : []),
  `${unmeasured.length} more rules ship in v0.1 but have no true positive in the corpus yet, so no precision number is claimed for them: ${unmeasured.map((r) => `${r.id} ${r.name}`).join('; ')}. The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).`,
  '<!-- rules:end -->',
].join('\n');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const updated = readme.includes('<!-- rules:start -->')
  ? readme.replace(/<!-- rules:start -->[\s\S]*<!-- rules:end -->/, block)
  : readme.replace(/## Rules in v0\.1[\s\S]*?(?=\n## Precision)/, `## Rules in v0.1\n\n${block}\n`);
writeFileSync(readmePath, updated);
process.stdout.write(`rules.md: ${rules.length} rules; README: ${promoted.length} promoted, ${notPromoted.length} measured not promoted, ${unmeasured.length} unmeasured\n`);
