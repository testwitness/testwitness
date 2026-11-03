import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diffFindings, discoverCases, runCase, summarise } from './golden.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Register one vitest suite per fixture project so projects run in parallel workers. */
export function goldenSuite(project: string): void {
  const cases = discoverCases(root, (c) => c.project === project);
  describe(`golden ${project}`, () => {
    it('has cases', () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const c of cases) {
      it(`${c.project}/${c.name}`, async () => {
        const { report } = await runCase(c);
        const { missing, unexpected } = diffFindings(c.expected, report.findings);
        const detail = `\nexpected: ${JSON.stringify(c.expected)}\nactual:   ${JSON.stringify(report.findings.map(summarise))}`;
        expect(missing, `missing findings${detail}`).toEqual([]);
        expect(unexpected, `unexpected findings${detail}`).toEqual([]);
      });
    }
  });
}
