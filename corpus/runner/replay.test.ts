// Acceptance criterion 1 of the agent guard: `check --worktree` gives the same findings, with the same fingerprints,
// as the commit to commit check gives once the change is committed. Proven on every corpus entry (so on every entry
// that has a medium or high finding), and the repository is byte for byte untouched by the working tree check.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from './corpus.js';
import { findingKey, pool, replayEntry, type ReplayResult } from './replay.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = loadCorpus(root);
const results = new Map<string, ReplayResult>();

beforeAll(async () => {
  const all = await pool(entries, 4, (e) => replayEntry(e));
  entries.forEach((e, i) => results.set(e.slug, all[i]!));
}, 900_000);

describe('working tree replay of the corpus', () => {
  it('covers the whole corpus, and most entries have a medium or high finding', () => {
    expect(entries.length).toBeGreaterThanOrEqual(134);
    const withFinding = entries.filter((e) => results.get(e.slug)!.commit.findings.some((f) => f.severity !== 'low'));
    expect(withFinding.length).toBeGreaterThanOrEqual(80);
  });

  for (const e of entries) {
    it(`${e.slug}: same findings and fingerprints as the commit check, repository untouched`, () => {
      const r = results.get(e.slug)!;
      expect(r.worktree.findings.map(findingKey)).toEqual(r.commit.findings.map(findingKey));
      expect(r.worktree.findings.map((f) => f.fingerprint)).toEqual(r.commit.findings.map((f) => f.fingerprint));
      expect(r.worktree.state).toBe(r.commit.state);
      expect(r.worktree.summary).toEqual(r.commit.summary);
      expect(r.worktree.files).toEqual(r.commit.files);
      expect(r.worktree.headTree).toMatch(/^[0-9a-f]{40,64}$/);
      expect(r.commit.headTree).toBeUndefined();
      expect(r.untouched).toBe(true);
    });
  }
});
