import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Report } from '@testwitness/core';
import { diffFindings, discoverCases, fullFinding, runCase, summarise } from './golden.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Register one vitest suite per fixture project so projects run in parallel workers. */
export function goldenSuite(project: string): void {
  const cases = discoverCases(root, (c) => c.project === project);
  // Reports of cases already run in this file, so a CRLF twin compares against its LF case without running it again.
  const reports = new Map<string, Report>();
  describe(`golden ${project}`, () => {
    it('has cases', () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const c of cases) {
      it(`${c.project}/${c.name}`, async () => {
        const { report } = await runCase(c);
        reports.set(c.name, report);
        const { missing, unexpected } = diffFindings(c.expected, report.findings);
        const detail = `\nexpected: ${JSON.stringify(c.expected)}\nactual:   ${JSON.stringify(report.findings.map(summarise))}`;
        expect(missing, `missing findings${detail}`).toEqual([]);
        expect(unexpected, `unexpected findings${detail}`).toEqual([]);
        // A CRLF twin must say exactly what its LF case says: lines, messages, snippets and fingerprints.
        const twinName = c.crlf?.twin;
        if (twinName) {
          const twin = cases.find((t) => t.name === twinName);
          expect(twin, `twin ${twinName}`).toBeDefined();
          const lf = reports.get(twinName) ?? (await runCase(twin!)).report;
          expect(report.findings.map(fullFinding)).toEqual(lf.findings.map(fullFinding));
        }
      });
    }
  });
}
