import { load } from '../graph';

const testWithVmEsm = typeof globalThis.vm === 'object' ? test : test.skip;

describe('graph', () => {
  testWithVmEsm('loads a module', async () => {
    expect(await load('a')).toBe(1);
  });

  testWithVmEsm('resolves a package imports specifier', async () => {
    expect(await load('#dep')).toBe(42);
  });

  testWithVmEsm('keeps a leading hash out of the fragment', async () => {
    expect(await load('#dep#frag')).toBe(42);
  });
});
