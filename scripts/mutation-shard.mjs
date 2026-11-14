#!/usr/bin/env node
// Writes stryker.shard.json for one shard of the mutation run, so the weekly
// workflow can spread the work over parallel jobs. Usage:
//   node scripts/mutation-shard.mjs <shard>      write the config for one shard
//   node scripts/mutation-shard.mjs --list       print the shard names as JSON
import { readFileSync, writeFileSync } from "node:fs";

const core = "packages/core/src";
export const SHARDS = {
  "core-rules-c": [`${core}/rules/C.ts`],
  "core-meaning": [`${core}/assertion-meaning.ts`],
  "core-rules-ra": [`${core}/rules/R.ts`, `${core}/rules/A.ts`],
  "core-helpers": [`${core}/helper-index.ts`, `${core}/config-text.ts`],
  "core-engine": [
    `${core}/engine.ts`,
    `${core}/git.ts`,
    `${core}/git-batch.ts`,
    `${core}/inventory.ts`,
    `${core}/diff/**/*.ts`,
    `${core}/treesitter.ts`,
  ],
  "core-rules-other": [`${core}/rules/{W,V,O,M,E,util,index}.ts`],
  "core-readers": [
    `${core}/{mutation,coverage,evidence,report}/**/*.ts`,
    `${core}/{config,acknowledge,provenance,hash,eol,types,index}.ts`,
  ],
  junit: ["packages/junit/src/**/*.ts"],
  "lang-ts": ["packages/lang-ts/src/**/*.ts"],
  "lang-java": ["packages/lang-java/src/**/*.ts"],
  "lang-python": ["packages/lang-python/src/**/*.ts"],
};

const arg = process.argv[2];
if (arg === "--list") {
  process.stdout.write(JSON.stringify(Object.keys(SHARDS)) + "\n");
} else if (arg && SHARDS[arg]) {
  const base = JSON.parse(readFileSync("stryker.config.json", "utf8"));
  base.mutate = [
    ...SHARDS[arg],
    "!**/*.test.ts",
    "!packages/core/src/rules/testkit.ts",
  ];
  base.incrementalFile = `reports/stryker-incremental-${arg}.json`;
  base.htmlReporter = { fileName: `reports/mutation/${arg}/index.html` };
  base.jsonReporter = { fileName: `reports/mutation/${arg}/mutation.json` };
  base.reporters = ["clear-text", "html", "json"];
  writeFileSync("stryker.shard.json", JSON.stringify(base, null, 2) + "\n");
  process.stdout.write(`stryker.shard.json written for ${arg}\n`);
} else {
  process.stderr.write(
    `usage: mutation-shard.mjs <${Object.keys(SHARDS).join("|")}> | --list\n`,
  );
  process.exit(2);
}
