import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pythonFrontEnd } from './index.js';
it('probe', async () => {
  const files = (process.env.PROBE ?? '').split(',').filter(Boolean);
  for (const f of files) {
    const i = await pythonFrontEnd.inventory('tests/test_x.py', readFileSync(f, 'utf8'), { frameworks: new Set(), extraAssertions: [] });
    console.log('FILE', f, 'parseErrors', i.parseErrors, 'helpers', [...i.assertionHelpers], 'fileMarkers', JSON.stringify(i.fileMarkers));
    for (const t of i.tests) console.log(JSON.stringify({ q: t.qualifiedName, st: t.statementCount, pc: t.parameterCount, h: t.bodyHash, m: t.markers, a: t.assertions.map(a => ({ c: a.callee, s: a.subject, e: a.expected, k: a.kind, str: a.strength, t: a.text })) }));
  }
});
