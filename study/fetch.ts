/**
 * Fetches base and head files for every sampled PR into <dir>/data/<slug>/, with
 * exactly the layout of corpus/entries/<slug>/ (see corpus/README.md):
 *   pr.json, pr-body.md, files/manifest.json, files/base/<path>, files/head/<path>
 * The copy rules are a direct port of corpus/_tools/files.py.
 *
 * usage: tsx --conditions=development study/fetch.ts [--dir study] [--pace 2000]
 * Resumable: PRs whose files/manifest.json exists are skipped.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendJsonl, ensureCommit, flag, isTestPath, log, mirror, readJsonl, run, runBuf, sleep, slugOf, studyDir, tryRun, type Rejected, type SampleRow } from './lib.js';

// ---- port of corpus/_tools/files.py (globs mirror packages/core/src/diff/classify.ts) ----
const TEST = ['**/*Test.java', '**/*Tests.java', '**/*IT.java', '**/*TestCase.java', '**/src/test/**/*.java', '**/src/test/**/*.kt',
  '**/*.test.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/*.spec.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/test/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/tests/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/e2e/**/*.{ts,js}',
  '**/test_*.py', '**/*_test.py', '**/tests/**/*.py', '**/test/**/*.py'];
const SNAP = ['**/__snapshots__/**', '**/*.snap', '**/*.approved.*', '**/*.received.*', '**/*.verified.*', '**/*.golden', '**/testdata/**/*.golden',
  '**/__screenshots__/**', '**/*-snapshots/**', '**/snapshots/**', '**/__snapshots__/**/*.ambr', '**/expected/**'];
const RUNNER = ['**/jest.config.{js,cjs,mjs,ts,cts,mts,json}', '**/vitest.config.{js,cjs,mjs,ts,cts,mts}', '**/vitest.workspace.{js,ts}', '**/vite.config.{js,ts,mjs,mts}',
  '**/playwright.config.{js,ts,mjs,mts}', '**/.mocharc.{js,cjs,yml,yaml,json,jsonc}', '**/package.json', '**/pytest.ini', '**/pyproject.toml', '**/setup.cfg', '**/tox.ini',
  '**/noxfile.py', '**/conftest.py', '**/pom.xml', '**/build.gradle', '**/build.gradle.kts', '**/settings.gradle', '**/settings.gradle.kts', '**/gradle.properties',
  '**/junit-platform.properties', '**/testng.xml', '**/testng*.xml', '**/Makefile', '**/.testwitness.yml'];
const WORKFLOW = ['.github/workflows/*.{yml,yaml}', '**/.gitlab-ci.yml', '**/.gitlab/**/*.yml', '**/Jenkinsfile', '**/azure-pipelines.yml', '**/.circleci/config.yml', '**/bitbucket-pipelines.yml'];
const CODE_EXT = ['.py', '.java', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.kt', '.scala', '.groovy', '.rs', '.go', '.cs', '.vue', '.svelte'];

function expand(g: string): string[] {
  const m = /\{([^}]*)\}/.exec(g);
  if (!m) return [g];
  return m[1]!.split(',').flatMap((alt) => expand(g.slice(0, m.index) + alt + g.slice(m.index + m[0].length)));
}
function toRe(g: string): RegExp {
  let r = '';
  let i = 0;
  while (i < g.length) {
    if (g.startsWith('**/', i)) {
      r += '(?:.*/)?';
      i += 3;
    } else if (g.startsWith('**', i)) {
      r += '.*';
      i += 2;
    } else if (g[i] === '*') {
      r += '[^/]*';
      i++;
    } else if (g[i] === '?') {
      r += '[^/]';
      i++;
    } else {
      r += g[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${r}$`);
}
const matcher = (globs: string[]) => {
  const rs = globs.flatMap(expand).map(toRe);
  return (p: string) => rs.some((r) => r.test(p));
};
const isTest = matcher(TEST);
const isSnap = matcher(SNAP);
const isRunner = matcher(RUNNER);
const isWf = matcher(WORKFLOW);
const wanted = (path: string, size: number) => isTest(path) || isSnap(path) || isRunner(path) || isWf(path) || (CODE_EXT.some((e) => path.endsWith(e)) && size < 50 * 1024);

function blobSize(g: string, sha: string, path: string): number | undefined {
  const r = tryRun('git', ['cat-file', '-s', `${sha}:${path}`], g);
  return r.ok ? Number(r.out.trim()) : undefined;
}
function copy(g: string, sha: string, path: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, runBuf('git', ['show', `${sha}:${path}`], g));
}

interface ManifestEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

/** files.py main() for one entry. */
function populateFiles(g: string, base: string, head: string, fdir: string): { manifest: ManifestEntry[]; copied: number } {
  rmSync(fdir, { recursive: true, force: true });
  mkdirSync(fdir, { recursive: true });
  const ns = run('git', ['diff', '--name-status', '--find-renames', base, head], g).split('\n').filter(Boolean);
  const manifest: ManifestEntry[] = [];
  let copied = 0;
  for (const line of ns) {
    const parts = line.split('\t');
    const st = parts[0]![0];
    const rec: ManifestEntry =
      st === 'R' ? { path: parts[2]!, status: 'renamed', oldPath: parts[1]! } : st === 'A' ? { path: parts[1]!, status: 'added' } : st === 'D' ? { path: parts[1]!, status: 'deleted' } : { path: parts[1]!, status: 'modified' };
    manifest.push(rec);
    if (rec.status !== 'added') {
      const old = rec.oldPath ?? rec.path;
      const s = blobSize(g, base, old);
      if (s !== undefined && wanted(old, s)) {
        copy(g, base, old, join(fdir, 'base', old));
        copied++;
      }
    }
    if (rec.status !== 'deleted') {
      const s = blobSize(g, head, rec.path);
      if (s !== undefined && wanted(rec.path, s)) {
        copy(g, head, rec.path, join(fdir, 'head', rec.path));
        copied++;
      }
    }
  }
  writeFileSync(join(fdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, copied };
}

async function main() {
  const dir = studyDir();
  const pace = flag('pace', 2000);
  const rejectedFile = join(dir, 'rejected.jsonl');
  const rejected = new Set(readJsonl<Rejected>(rejectedFile).map((r) => r.url));
  const rows = readJsonl<SampleRow>(join(dir, 'sample.jsonl')).filter((r) => !rejected.has(r.url));
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let first = true;
  for (const r of rows) {
    const slug = slugOf(r.repo, r.number);
    const d = join(dir, 'data', slug);
    if (existsSync(join(d, 'files', 'manifest.json'))) {
      skipped++;
      continue;
    }
    if (!first) await sleep(pace);
    first = false;
    try {
      const g = mirror(r.repo, r.number);
      ensureCommit(g, r.base_sha);
      ensureCommit(g, r.head_sha);
      mkdirSync(d, { recursive: true });
      const pr = {
        url: r.url,
        repo: r.repo,
        number: r.number,
        title: r.title,
        created_at: r.created_at,
        merged_at: r.merged_at,
        stars: r.stars,
        license: r.license,
        language: r.language,
        agent: r.agent,
        base_sha: r.base_sha,
        head_sha: r.head_sha,
        files_changed: r.files_changed,
        additions: r.additions,
        deletions: r.deletions,
      };
      writeFileSync(join(d, 'pr.json'), JSON.stringify(pr, null, 2) + '\n');
      writeFileSync(join(d, 'pr-body.md'), r.body);
      const { manifest, copied } = populateFiles(g, r.base_sha, r.head_sha, join(d, 'files'));
      // Later check: the sample filter used numstat paths; confirm on the manifest.
      if (!manifest.some((m) => isTestPath(m.path) || (m.oldPath !== undefined && isTestPath(m.oldPath)))) {
        appendJsonl(rejectedFile, { url: r.url, agent: r.agent, language: r.language, reason: 'touches no test file (fetch check)' } satisfies Rejected);
        rmSync(d, { recursive: true, force: true });
        log(`${slug}: excluded, no test file in manifest`);
        continue;
      }
      done++;
      log(`${slug}: ${manifest.length} changed, ${copied} files copied`);
    } catch (e) {
      failed++;
      log(`${slug}: FAILED ${String((e as Error).message).split('\n')[0]}`);
      rmSync(join(d, 'files'), { recursive: true, force: true });
    }
  }
  process.stdout.write(`fetch: ${done} fetched, ${skipped} already present, ${failed} failed, ${rows.length} in sample\n`);
}

await main();
