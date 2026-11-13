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
  lines.push(`## ${r.id} ${r.name}`, '', `Default severity: ${r.defaultSeverity}. Since ${r.since}. Languages: ${r.languages === 'any' ? 'all' : r.languages.join(', ')}. Needs: ${r.needs.join(', ')}.`, '', md(r.docs.summary), '', `**False positive controls.** ${md(r.docs.falsePositives)}`, '', ...(r.docs.history ? [`**With run history.** ${md(r.docs.history)} See [run history](history.md).`, ''] : []), '```diff', r.docs.example, '```', '');
}
writeFileSync(join(root, 'docs', 'rules.md'), lines.join('\n'));

// README table from corpus verdicts
interface Verdict { ruleId: string; verdict: string; severity: string; split: string }
const verdictsPath = join(root, 'corpus', 'verdicts.json');
const verdicts: Verdict[] = existsSync(verdictsPath) ? JSON.parse(readFileSync(verdictsPath, 'utf8')) : [];
const stats = new Map<string, { tp: number; fp: number }>();
for (const v of verdicts) {
  const s = stats.get(v.ruleId) ?? { tp: 0, fp: 0 };
  if (v.verdict === 'tp') s.tp++;
  if (v.verdict === 'fp') s.fp++;
  stats.set(v.ruleId, s);
}
const measured = rules.filter((r) => (stats.get(r.id)?.tp ?? 0) > 0);
const unmeasured = rules.filter((r) => (stats.get(r.id)?.tp ?? 0) === 0);
const table = ['| Rule | Finding | Default | True positives | False positives (medium or high) | Precision |', '|---|---|---|---|---|---|'];
for (const r of measured) {
  const s = stats.get(r.id)!;
  table.push(`| ${r.id} | ${r.name} | ${r.defaultSeverity} | ${s.tp} | ${s.fp} | ${(s.tp / (s.tp + s.fp)).toFixed(2)} |`);
}
const block = [
  '<!-- rules:start -->',
  `Rules with measured true positives on the public PR corpus (see [docs/precision.md](docs/precision.md)):`,
  '',
  ...table,
  '',
  `${unmeasured.length} more rules ship in v0.1 but have no true positive in the corpus yet, so no precision number is claimed for them: ${unmeasured.map((r) => `${r.id} ${r.name}`).join('; ')}. The full catalogue with false positive controls is in [docs/rules.md](docs/rules.md).`,
  '<!-- rules:end -->',
].join('\n');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const updated = readme.includes('<!-- rules:start -->')
  ? readme.replace(/<!-- rules:start -->[\s\S]*<!-- rules:end -->/, block)
  : readme.replace(/## Rules in v0\.1[\s\S]*?(?=\n## Precision)/, `## Rules in v0.1\n\n${block}\n`);
writeFileSync(readmePath, updated);
process.stdout.write(`rules.md: ${rules.length} rules; README: ${measured.length} measured, ${unmeasured.length} unmeasured\n`);
