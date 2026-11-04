import { runInstall } from './testing/result';

describe('install', () => {
  it('creates the package directory', () => {
    const result = runInstall('leftpad');
    expect(result.filesCreated).toContain('node_modules/leftpad');
    expect(result.filesCreated).toContain('node_modules/leftpad/index.js');
    expect(result.code).toBe(0);
  });

  it('reports success', () => {
    const result = runInstall('leftpad');
    expect(result.code).toBe(0);
  });
});
