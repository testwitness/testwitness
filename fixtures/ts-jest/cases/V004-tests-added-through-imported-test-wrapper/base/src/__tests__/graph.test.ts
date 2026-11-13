import { testWithVmEsm } from '@acme/test-utils';
import { load } from '../graph';

describe('graph', () => {
  testWithVmEsm('loads a module', async () => {
    expect(await load('a')).toBe(1);
  });
});
