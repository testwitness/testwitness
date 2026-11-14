// Security: test source a pull request controls must not take the check hostage (docs/threat-model.md, "Known limits").
import { describe, expect, it } from 'vitest';
import { tsFrontEnd } from './index.js';
import { emptyProfile } from './helpers.test-util.js';

const TEST = "import { expect, it } from 'vitest';\nit('a', () => { expect(1).toBe(1); });\n";

describe('hostile test source', () => {
  it('deeply nested, well formed code is read', async () => {
    for (const extra of [`const d = ${'('.repeat(30_000)}1${')'.repeat(30_000)};`, `const d = ${'['.repeat(30_000)}${']'.repeat(30_000)};`, `${'{'.repeat(30_000)}${'}'.repeat(30_000)}`]) {
      const t0 = performance.now();
      const inv = await tsFrontEnd.inventory('a.test.ts', `${TEST}${extra}\n`, emptyProfile);
      expect(inv.tests.map((t) => t.qualifiedName)).toEqual(['a']);
      expect(performance.now() - t0).toBeLessThan(5000);
    }
  }, 60_000);

  // OPEN (docs/threat-model.md, "Known limits", L1). Thirty thousand unclosed brackets take about six seconds and the
  // time grows with the square of the count: tree-sitter builds a tree as deep as the brackets, and running the
  // queries over a tree that deep is quadratic inside the query engine (measured: the parse takes 17 ms, the four
  // queries the rest). 100 kB of `[` took 77 s through the whole check. Not fixed here because the two small fixes
  // both change what the check reports: refusing such a file hides its tests from the rules (fail open), and a time
  // limit makes the result depend on the machine. The fix that keeps the report the same is a query that does not
  // descend into ERROR nodes, which needs the queries of all three languages reworked. When this test starts to
  // pass, the limit is gone: change `it.fails` to `it`.
  it.fails('unclosed brackets are read in linear time', async () => {
    const t0 = performance.now();
    await tsFrontEnd.inventory('a.test.ts', `${TEST}foo(${'['.repeat(30_000)}\n`, emptyProfile);
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 120_000);
});
