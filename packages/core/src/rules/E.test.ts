import { describe, expect, it } from 'vitest';
import { E001 } from './E.js';
import { changedFile, context, inventory, test as t } from './testkit.js';

const P = 'src/billing.test.ts';
const swallow = { line: 5, binding: 'Exception', swallows: true, snippet: 'svc.reconcile(ledger)' };

describe('E001 catch all added', () => {
  it('reports a new swallowing catch in a modified or added test', async () => {
    const base = t({ name: 'a', body: 'x' });
    const head = { ...t({ name: 'a', body: 'y' }), catchAlls: [swallow] };
    const out = await E001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {});
    expect(out[0]).toMatchObject({ ruleId: 'E001', severity: 'high', subject: 'a', location: { line: 5 } });
    expect(await E001.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [head]) }] }), {})).toHaveLength(1);
  });
  it('ignores catches that assert or rethrow, and catches already in the base', async () => {
    const asserting = { ...t({ name: 'a', body: 'y' }), catchAlls: [{ ...swallow, swallows: false }] };
    expect(await E001.run(context({ pairs: [{ file: changedFile(P, 'added'), head: inventory(P, [asserting]) }] }), {})).toEqual([]);
    const base = { ...t({ name: 'a', body: 'x' }), catchAlls: [swallow] };
    const head = { ...t({ name: 'a', body: 'y' }), catchAlls: [swallow] };
    expect(await E001.run(context({ pairs: [{ file: changedFile(P), base: inventory(P, [base]), head: inventory(P, [head]) }] }), {})).toEqual([]);
  });
});
