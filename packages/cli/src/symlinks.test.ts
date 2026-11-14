// Review decision 1: report globs do not follow symbolic links unless paths.followSymlinks or --follow-symlinks says so.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvidence, matchReportFiles } from './check.js';
import { TMP } from './testing/repo.js';

const xml = (name: string) => `<testsuite name="s"><testcase classname="C" name="${name}"/></testsuite>`;

/** A checkout with one real results file, a link to a file outside it, and a linked directory leading outside. */
function layout(): { root: string; repo: string; outside: string } {
  const root = mkdtempSync(join(TMP, 'tw-links-'));
  const repo = join(root, 'repo');
  const outside = join(root, 'outside');
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(repo, 'test-results', 'real.xml'), xml('real'));
  writeFileSync(join(outside, 'secret.xml'), xml('secret'));
  symlinkSync(join(outside, 'secret.xml'), join(repo, 'test-results', 'link.xml'));
  symlinkSync(outside, join(repo, 'bazel-testlogs'));
  return { root, repo, outside };
}

describe('report globs and symbolic links', () => {
  it('skips a linked file and a file reached through a linked directory by default, with a note', async () => {
    const { repo } = layout();
    const m = await matchReportFiles(repo, ['**/*.xml', 'bazel-testlogs/**/*.xml'], false);
    expect(m.files.map((f) => f.slice(repo.length + 1))).toEqual(['test-results/real.xml']);
    expect(m.notes[0]).toMatch(/^2 matched paths were skipped because they are a symbolic link or outside the repository \(bazel-testlogs, test-results\/link\.xml\); set paths\.followSymlinks/);
    const { evidence, notes } = await loadEvidence(repo, '**/*.xml,bazel-testlogs/**/*.xml', () => {});
    expect([...evidence!.keys()]).toEqual(['c::real']);
    expect(notes[0]).toMatch(/symbolic link/);
  });

  it('follows links when asked, for Bazel style layouts', async () => {
    const { repo } = layout();
    const m = await matchReportFiles(repo, ['test-results/*.xml', 'bazel-testlogs/**/*.xml'], true);
    expect(m.files.map((f) => f.slice(repo.length + 1)).sort()).toEqual(['bazel-testlogs/secret.xml', 'test-results/link.xml', 'test-results/real.xml']);
    expect(m.notes).toEqual([]);
  });

  it('still reads an absolute glob the workflow points outside the repository on purpose', async () => {
    const { repo, outside } = layout();
    // A glob is written with forward slashes on every platform, as the CLI and the Action pass it.
    const m = await matchReportFiles(repo, [`${outside.replace(/\\/g, '/')}/*.xml`], false);
    expect(m.files.map((f) => resolve(f))).toEqual([join(outside, 'secret.xml')]);
  });
});

describe('8.3 short paths on Windows', () => {
  // On the Windows runner os.tmpdir() is the short form (C:\Users\RUNNER~1\...) and TMP the long one, so a glob a
  // workflow writes with the short form must still reach the same files.
  it.runIf(process.platform === 'win32' && tmpdir() !== TMP)('reads an absolute glob written with the short form of a long path', async () => {
    const { repo, outside } = layout();
    const short = join(tmpdir(), outside.slice(TMP.length));
    const m = await matchReportFiles(repo, [`${short.replace(/\\/g, '/')}/*.xml`], false);
    expect(m.files.map((f) => realpathSync.native(f))).toEqual([join(outside, 'secret.xml')]);
  });
});
