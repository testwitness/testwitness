#!/usr/bin/env node
// Reads every reports/mutation/**/mutation.json (one per shard) and prints the
// mutation score per package as a markdown table. Score = (killed + timeout) /
// (all mutants that are not ignored, not compile errors and not runtime errors),
// the same definition Stryker uses for its "mutation score".
// Usage: node scripts/mutation-summary.mjs [dir] [--min-core <percent>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const minIdx = args.indexOf("--min-core");
const minCore = minIdx >= 0 ? Number(args[minIdx + 1]) : undefined;
const dir =
  args.find((a, i) => !a.startsWith("--") && i !== minIdx + 1) ??
  "reports/mutation";

function* walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name === "mutation.json") yield p;
  }
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNCOUNTED = new Set(["Ignored", "CompileError", "RuntimeError"]);
const byPkg = new Map();
let reports = 0;
for (const file of walk(dir)) {
  reports++;
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const [path, entry] of Object.entries(report.files ?? {})) {
    const m = /packages\/([^/]+)\//.exec(path.replaceAll("\\", "/"));
    const pkg = m ? m[1] : "other";
    const row = byPkg.get(pkg) ?? {
      detected: 0,
      survived: 0,
      noCoverage: 0,
      total: 0,
    };
    for (const mutant of entry.mutants ?? []) {
      if (UNCOUNTED.has(mutant.status)) continue;
      row.total++;
      if (DETECTED.has(mutant.status)) row.detected++;
      else if (mutant.status === "NoCoverage") row.noCoverage++;
      else row.survived++;
    }
    byPkg.set(pkg, row);
  }
}
if (reports === 0) {
  process.stderr.write(`no mutation.json under ${dir}\n`);
  process.exit(1);
}
const pct = (r) => (r.total ? (100 * r.detected) / r.total : 0);
const lines = [
  "| Package | Mutants | Killed or timed out | Survived | No coverage | Score |",
  "|---|---|---|---|---|---|",
];
for (const [pkg, r] of [...byPkg].sort()) {
  lines.push(
    `| ${pkg} | ${r.total} | ${r.detected} | ${r.survived} | ${r.noCoverage} | ${pct(r).toFixed(1)}% |`,
  );
}
process.stdout.write(lines.join("\n") + "\n");
const core = byPkg.get("core");
if (minCore !== undefined && core && pct(core) < minCore) {
  process.stderr.write(
    `core mutation score ${pct(core).toFixed(1)}% is below ${minCore}%\n`,
  );
  process.exit(1);
}
