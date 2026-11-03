// @ts-nocheck
// Run the engine on selected entries and print all findings (no judging). usage: tsx corpus/_tools/triage.ts slug...
import { loadCorpus, runEntry } from '../runner/corpus.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const want = new Set(process.argv.slice(2));
for (const e of loadCorpus(root)) {
  if (want.size && !want.has(e.slug)) continue;
  const r = await runEntry(e);
  process.stdout.write(`${e.slug} findings=${r.findings.length}\n`);
  for (const f of r.findings) process.stdout.write(`    ${f.ruleId} ${f.severity} ${f.subject ?? ''} ${f.label ?? ''} :: ${f.message.slice(0, 120)}\n`);
}
