import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diffFindings, discoverCases, runCase, summarise } from './golden.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cases = discoverCases(root);

describe('golden fixtures', () => {
  it('finds at least one case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  for (const c of cases) {
    it(`${c.project}/${c.name}`, async () => {
      const { report } = await runCase(c);
      // V005 (no JUnit XML found) fires for every case that ships no junit directory. It says nothing
      // about the case itself, so it is only compared when the case provides evidence.
      const findings = c.junit ? report.findings : report.findings.filter((f) => f.ruleId !== 'V005');
      const { missing, unexpected } = diffFindings(c.expected, findings);
      const detail = `\nexpected: ${JSON.stringify(c.expected)}\nactual:   ${JSON.stringify(findings.map(summarise))}`;
      expect(missing, `missing findings${detail}`).toEqual([]);
      expect(unexpected, `unexpected findings${detail}`).toEqual([]);
    });
  }
});
