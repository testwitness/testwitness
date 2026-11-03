// @ts-nocheck
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { judge, loadCorpus, precisionTable, renderPrecisionMarkdown, runEntry, type Verdict } from './corpus.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = loadCorpus(root);
const verdicts: Verdict[] = [];
for (const e of entries) {
  const report = await runEntry(e);
  const v = judge(e, report.findings);
  verdicts.push(...v);
  const fps = v.filter((x) => x.verdict === 'fp');
  const missed = v.filter((x) => x.verdict === 'missed');
  process.stdout.write(`${e.slug.padEnd(40)} ${e.meta.split.padEnd(8)} findings=${report.findings.length} fp=${fps.length} missed=${missed.length}\n`);
  for (const f of fps) process.stdout.write(`    FP   ${f.ruleId} ${f.severity} ${f.subject ?? ''} ${f.label ?? ''}\n`);
  for (const m of missed) process.stdout.write(`    MISS ${m.ruleId} ${m.severity} ${m.subject ?? ''}\n`);
}
const rows = precisionTable(verdicts);
const md = renderPrecisionMarkdown(rows, entries.length, new Date().toISOString().slice(0, 10));
writeFileSync(join(root, '..', 'docs', 'precision.md'), md);
writeFileSync(join(root, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
process.stdout.write('\n' + md);
