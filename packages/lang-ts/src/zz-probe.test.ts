import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInventory } from './inventory.js';

it('probe', async () => {
  const files = (process.env.PROBE ?? '').split(',').filter(Boolean);
  for (const f of files) {
    const inv = await buildInventory(f.replace(/^.*\/(base|head)\//, ''), readFileSync(f, 'utf8'), { frameworks: new Set(), extraAssertions: [] });
    const out = { path: inv.path, framework: inv.framework, parseErrors: inv.parseErrors, helpers: [...inv.assertionHelpers], fileMarkers: inv.fileMarkers, tests: inv.tests.map((t) => ({ q: t.qualifiedName, st: t.statementCount, hash: t.bodyHash, pc: t.parameterCount, markers: t.markers, assertions: t.assertions.map((a) => ({ callee: a.callee, kind: a.kind, subject: a.subject, expected: a.expected, family: a.family, strength: a.strength, text: a.text })) })) };
    console.log(JSON.stringify(out, null, 1));
  }
});
