import { runInstall } from './testing/install-result';

describe('install', () => {
  it('creates the package directory', () => {
    const result = runInstall('leftpad');
    result.hasCreated('node_modules/leftpad');
    result.hasCreated('node_modules/leftpad/index.js');
    expect(result.code).toBe(0);
  });
});
