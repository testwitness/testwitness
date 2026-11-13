import { load } from '../graph';

const testWithVmEsm = typeof globalThis.vm === 'object' ? test : test.skip;

describe('graph', () => {
  testWithVmEsm('resolves a package imports specifier', async () => {
    expect(await load('#dep')).toBe(42);
  });
});
