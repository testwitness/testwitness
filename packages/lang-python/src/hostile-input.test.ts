// Security regressions for the ReDoS scan (docs/threat-model.md, "ReDoS"): Python source a pull request controls.
import { describe, expect, it } from 'vitest';
import { isPythonTestFile, pythonFrontEnd } from './index.js';

const N = 100_000;

describe('hostile Python source', () => {
  it('the content sniff reads a file of blank lines in linear time and still finds a test', () => {
    const t0 = performance.now();
    expect(isPythonTestFile('pkg/checks.py', '\n'.repeat(N))).toBe(false);
    expect(isPythonTestFile('pkg/checks.py', ' '.repeat(N))).toBe(false);
    expect(isPythonTestFile('pkg/checks.py', '\u2028'.repeat(N))).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(isPythonTestFile('pkg/checks.py', '\n\n   \n    async def test_x():\n        pass\n')).toBe(true);
    expect(isPythonTestFile('pkg/checks.py', 'x = 1\ndef test_y():\n    pass\n')).toBe(true);
    expect(isPythonTestFile('pkg/checks.py', 'x = "def test_y"\n')).toBe(false);
  });

  it('an except clause with a long run of spaces is read in linear time, and the alias is still split off', async () => {
    const profile = { frameworks: new Set<string>(), extraAssertions: [] };
    const src = (gap: string): string => `def test_a():\n    try:\n        run()\n    except (ValueError,${gap}Exception) as err:\n        pass\n`;
    const t0 = performance.now();
    const big = await pythonFrontEnd.inventory('test_a.py', src(' '.repeat(N)), profile);
    expect(performance.now() - t0).toBeLessThan(5000);
    const small = await pythonFrontEnd.inventory('test_a.py', src(' '), profile);
    expect(small.tests[0]!.catchAlls).toEqual([{ line: 4, binding: '(ValueError, Exception)', swallows: true, snippet: 'run()' }]);
    expect(big.tests[0]!.catchAlls?.[0]?.swallows).toBe(true);
  }, 60_000);
});
