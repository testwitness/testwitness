import { describe, expect, it } from 'vitest';
import { findClaims, stripNonProse } from './claims.js';

describe('findClaims', () => {
  it('finds the documented phrases', () => {
    const kinds = findClaims('All tests pass. CI is green. Verified locally and tested locally. 100% coverage. Added tests for X. No test changes. Ran the full test suite. Fully tested.').map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['tests-pass', 'ci-green', 'verified', 'tested-locally', 'full-coverage', 'added-tests', 'no-test-changes', 'ran-suite']));
  });
  it('ignores code blocks, inline code, comments, unchecked checklist items and negations', () => {
    expect(findClaims('```\nall tests pass\n```')).toEqual([]);
    expect(findClaims('run `npm test` until tests pass')).toHaveLength(1);
    expect(findClaims('<!-- say if all tests pass -->')).toEqual([]);
    expect(findClaims('- [ ] all tests pass')).toEqual([]);
    expect(findClaims('- [x] all tests pass')).toHaveLength(1);
    expect(findClaims('tests do not pass yet')).toEqual([]);
  });
  it('dedupes and honours extra phrases', () => {
    const c = findClaims('tests pass. tests pass.', ['ran the whole thing']);
    expect(c.filter((x) => x.kind === 'tests-pass')).toHaveLength(1);
    expect(findClaims('I ran the whole thing', ['ran the whole thing'])).toEqual([{ kind: 'tests-pass', text: 'ran the whole thing' }]);
  });
  it('stripNonProse keeps prose', () => {
    expect(stripNonProse('hello `x` world')).toBe('hello   world');
  });
});
