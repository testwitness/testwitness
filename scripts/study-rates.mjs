#!/usr/bin/env node
// Recomputes every number in docs/agent-pr-evaluation.md from docs/evaluation/data/*.csv.
// Usage: node scripts/study-rates.mjs
// prs.csv has one row per pull request per cohort (a pull request in two cohorts appears twice).
// judged.csv has one row per candidate that at least one judge called a real weakening, plus every
// finding reported at medium or high, with both judges' labels (TP or WEAKENING means real).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../docs/evaluation/data');
const readCsv = (name) => {
  const [head, ...lines] = readFileSync(join(dir, name), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};
const prs = readCsv('prs.csv');
const judged = readCsv('judged.csv');
const real = (l) => l === 'TP' || l === 'WEAKENING';
const SHAPES = new Set(['R003', 'R004', 'R005', 'A002']);
const key = (r) => `${r.repo}#${r.number}`;

function wilson(k, n, z = 1.959964) {
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
const per100 = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${k} of ${n}: ${((100 * k) / n).toFixed(2)} per 100 (${(100 * lo).toFixed(2)} to ${(100 * hi).toFixed(2)})`;
};

// A weakening event: a judged candidate of one of the four shapes (or a weakening found by reading) that
// at least one judge (upper bound) or both judges (lower bound) called real.
const weakening = judged.filter((r) => (real(r.judge1) || real(r.judge2)) && (r.rule === '' || SHAPES.has(r.rule) || r.judge1 === 'WEAKENING' || r.judge2 === 'WEAKENING'));
const upper = new Map(), lower = new Map();
for (const r of weakening) {
  const k = `${r.sample}|${r.cohort}|${key(r)}`;
  upper.set(k, r);
  if (real(r.judge1) && real(r.judge2)) lower.set(k, r);
}
const cohorts = [
  ['Merged, agent', 'merged', ['agent']],
  ['Merged, human', 'merged', ['human']],
  ['Merged, all', 'merged', ['agent', 'human']],
  ['Closed without merge, agent', 'second', ['closed']],
  ['Restore phrase in comments, agent', 'second', ['restore']],
];
console.log('Rows in prs.csv:', prs.length, ' distinct pull requests:', new Set(prs.map(key)).size);
for (const [label, sample, cs] of cohorts) {
  const n = prs.filter((p) => p.sample === sample && cs.includes(p.cohort)).length;
  const count = (m) => new Set([...m.values()].filter((r) => r.sample === sample && cs.includes(r.cohort)).map(key)).size;
  console.log(`${label}\n  upper ${per100(count(upper), n)}\n  lower ${per100(count(lower), n)}`);
}
const allUpper = new Set([...upper.values()].map(key)), allLower = new Set([...lower.values()].map(key));
console.log(`Distinct pull requests with a weakening, all samples: upper ${allUpper.size}, lower ${allLower.size}`);

// What the released build (0.1.2) reports at medium or high, by distinct pull request.
// Tune and validate were measured on 0.1.1, where A002 also reported at medium; 0.1.2 caps A002 at low and reports
// only R003, R004 and R005 at medium or high, so those are the findings 0.1.2 gives.
const reported = judged.filter((r) => r.reported_at_medium_or_high === 'yes' && ['R003', 'R004', 'R005'].includes(r.rule));
const reportedPrs = new Map();
for (const r of reported) {
  const k = key(r);
  const prev = reportedPrs.get(k) ?? { real: false, rule: r.rule };
  reportedPrs.set(k, { real: prev.real || (real(r.judge1) && real(r.judge2)), rule: r.rule });
}
const right = [...reportedPrs.values()].filter((v) => v.real).length;
const [lo] = wilson(right, reportedPrs.size);
console.log(`0.1.2 reports at medium or high: ${reportedPrs.size} distinct pull requests, ${right} real (both judges), Wilson lower ${lo.toFixed(2)}; rules ${[...new Set([...reportedPrs.values()].map((v) => v.rule))].join(',')}`);
const missed = [...allUpper].filter((k) => !reportedPrs.has(k));
const byRule = {};
for (const k of missed) {
  const r = weakening.find((w) => key(w) === k);
  byRule[r.rule || 'found by reading'] = (byRule[r.rule || 'found by reading'] ?? 0) + 1;
}
console.log(`Missed by 0.1.2 (upper bound, distinct pull requests): ${missed.length}`, byRule);
