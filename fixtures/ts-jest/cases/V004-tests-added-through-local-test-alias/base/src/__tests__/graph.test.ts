import { load } from '../graph';

const testWithVmEsm = typeof globalThis.vm === 'object' ? test : test.skip;

describe('graph', () => {
  testWithVmEsm('loads a module', async () => {
    expect(await load('a')).toBe(1);
  });
});
