# Mutation testing

This page is about the mutation score of testwitness's own code. To have testwitness read mutation reports of a pull request in your repository, see [mutation on request](./mutation-on-request).

StrykerJS runs over `packages/core/src` with the vitest unit project (fixture cases are excluded because each spawns a git repository). Incremental mode keeps `reports/stryker-incremental.json` so later runs only retest what changed. Run: `pnpm mutate` (about 20 minutes on 2 cores with `--concurrency 2`).

## Score on 3 November 2026

Second run, after unit tests for engine, git, markdown, treesitter, hash and the W tables (704 unit tests): overall 55.8 percent; 60.6 percent on covered code. 2,773 killed, 22 timed out, 1,817 survived, 399 without coverage, 95 runtime errors. Per file after that run: engine.ts 68.7 (was 0), report/markdown.ts 82.7 (was 0), git.ts 88.4 (was 0), treesitter.ts 70.3 (was 0), hash.ts 100, rules/W.ts 39.5 (regex survivors, see below).

First full run earlier the same day (5,106 mutants): overall 43.8 percent; 56.5 percent on covered code. 2,173 killed, 14 timed out, 1,685 survived, 1,124 without coverage, 110 runtime errors. The table below is from that first run; the last column is the score on covered mutants.

| File | Mutants | Killed | Survived | No coverage | Score on covered |
|---|---|---|---|---|---|
| rules/R.ts | 779 | 355 | 296 | 128 | 54.5 |
| rules/W.ts | 696 | 251 | 436 | 9 | 36.5 |
| rules/A.ts | 469 | 222 | 199 | 48 | 52.7 |
| config.ts | 452 | 255 | 118 | 79 | 68.4 |
| engine.ts | 358 | 0 | 0 | 358 | none (fixture covered only) |
| rules/V.ts | 324 | 168 | 134 | 22 | 55.6 |
| diff/parse.ts | 254 | 172 | 65 | 17 | 72.6 |
| rules/util.ts | 204 | 79 | 68 | 57 | 53.7 |
| evidence/normalise.ts | 166 | 128 | 37 | 1 | 77.6 |
| inventory.ts | 165 | 109 | 46 | 10 | 70.3 |
| evidence/claims.ts | 162 | 77 | 85 | 0 | 47.5 |
| rules/O.ts | 158 | 73 | 66 | 19 | 52.5 |
| diff/classify.ts | 153 | 109 | 30 | 14 | 78.4 |
| report/markdown.ts | 150 | 0 | 0 | 150 | none (fixture covered only) |
| acknowledge.ts | 134 | 91 | 33 | 10 | 73.4 |
| git.ts | 112 | 0 | 0 | 112 | none (fixture covered only) |
| provenance.ts | 108 | 61 | 41 | 6 | 59.8 |
| treesitter.ts | 77 | 0 | 0 | 77 | none (lang package tests cover it indirectly) |
| rules/E.ts | 54 | 30 | 20 | 4 | 60.0 |

## Reading it

- The four files with no unit coverage (engine, markdown, git, treesitter) are exercised by the 555 golden fixture cases, which Stryker does not run. Unit tests for them are the next step and the cheapest way to move the number.
- W.ts is regex heavy. Many survivors are equivalent mutants inside character classes and alternations (a changed bound that no fixture exercises). The fix is more table driven matching and one unit test per suppressor pattern, both directions.
- Message text mutants (a word changed inside a finding message) survive by design: tests assert on rule id, severity, subject and label, not on prose. They inflate the survivor count without hiding a defect.
- Thresholds in `stryker.config.json`: high 80, low 60, break 40. The break threshold sits below the current score so the weekly job fails only on a regression; it moves up as the score does.

The HTML report is in `reports/mutation/index.html` after a run.
