import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCorpus, precisionTable, renderPrecisionMarkdown, type Verdict } from './corpus.js';
import { hookStats, renderHookReplayMarkdown, replayWithHook, type EntryReplay } from './hook-replay.js';

// One pass: each entry is applied as a working tree change (the agent hook replay), then committed and checked commit
// to commit. The precision table is judged on the commit check, as before; the hook section on the working tree.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = loadCorpus(root);
const verdicts: Verdict[] = [];
const replays: EntryReplay[] = [];
for (const e of entries) {
  const r = await replayWithHook(e);
  replays.push(r);
  const v = r.judged.map((j) => j.verdict);
  verdicts.push(...v);
  const fps = v.filter((x) => x.verdict === 'fp');
  const missed = v.filter((x) => x.verdict === 'missed');
  process.stdout.write(`${e.slug.padEnd(40)} ${e.meta.split.padEnd(8)} findings=${r.replay.commit.findings.length} fp=${fps.length} missed=${missed.length} hook=${r.hook.blocked ? 'block' : 'allow'}\n`);
  for (const f of fps) process.stdout.write(`    FP   ${f.ruleId} ${f.severity} ${f.subject ?? ''} ${f.label ?? ''}\n`);
  for (const m of missed) process.stdout.write(`    MISS ${m.ruleId} ${m.severity} ${m.subject ?? ''}\n`);
}
const rows = precisionTable(verdicts);
const date = new Date().toISOString().slice(0, 10);
const md = renderPrecisionMarkdown(rows, entries.length, date) + '\n' + renderHookReplayMarkdown(hookStats(replays), date);
writeFileSync(join(root, '..', 'docs', 'precision.md'), md);
writeFileSync(join(root, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
process.stdout.write('\n' + md);
