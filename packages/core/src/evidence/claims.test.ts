import { describe, expect, it } from 'vitest';
import { findClaims, stripNonProse } from './claims.js';
import type { ClaimKind } from './claims.js';

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
  it('never reads an added tests claim from a checklist line, and honours a negation later on the line', () => {
    expect(findClaims('- [x] Add test case(s)')).toEqual([]);
    expect(findClaims('* [X] I have added tests to confirm my change works.')).toEqual([]);
    expect(findClaims('1. [x] Added tests')).toEqual([]);
    expect(findClaims('Added tests: not applicable, this deletes a test')).toEqual([]);
    expect(findClaims('Added tests, no new test needed beyond the updated one')).toEqual([]);
    expect(findClaims('Added tests for refunds.\nNot applicable to the docs.').map((c) => c.kind)).toEqual(['added-tests']);
    expect(findClaims('- [x] all tests pass').map((c) => c.kind)).toEqual(['tests-pass']);
    expect(findClaims('- [x] I have added new tests where possible', [], { checklistClaims: true }).map((c) => c.kind)).toEqual(['added-tests']);
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

const TABLE: Array<{ kind: ClaimKind; phrasings: Array<[string, string]>; negations: string[] }> = [
  { kind: 'tests-pass', phrasings: [['All tests pass.', 'All tests pass'], ['The unit tests are green now', 'unit tests are green'], ['Everything is all green', 'all green'], ['This is fully tested', 'fully tested']], negations: ['Not all tests pass', 'No tests pass'] },
  { kind: 'ci-green', phrasings: [['CI is green', 'CI is green'], ['ci passing on the branch', 'ci passing']], negations: ['CI is not green', 'Not ci passing'] },
  { kind: 'verified', phrasings: [['Verified the fix', 'Verified'], ['validated against prod data', 'validated']], negations: ['Not verified', 'Never validated'] },
  { kind: 'tested-locally', phrasings: [['Tested locally', 'Tested locally'], ['tested on my machine', 'tested on my machine']], negations: ['Not tested locally', 'Never tested manually'] },
  { kind: 'full-coverage', phrasings: [['Reaches 100% coverage', '100% coverage'], ['now 100 % test coverage', '100 % test coverage']], negations: ['Not 100% coverage', 'Without 100% test coverage'] },
  { kind: 'added-tests', phrasings: [['Added tests for the parser', 'Added tests'], ['includes regression tests', 'includes regression tests']], negations: ['No new tests', 'Not added tests'] },
  { kind: 'no-test-changes', phrasings: [['There are no test changes', 'no test changes'], ['No test change needed', 'No test change']], negations: ['There are test changes', 'Not no test changes'] },
  { kind: 'ran-suite', phrasings: [['I ran the full suite', 'ran the full suite'], ['Ran suite twice', 'Ran suite']], negations: ['Not ran the suite', 'Never ran the whole suite'] },
];

describe('findClaims pattern table', () => {
  it('covers every claim kind', () => {
    expect(TABLE.map((t) => t.kind).sort()).toEqual(['added-tests', 'ci-green', 'full-coverage', 'no-test-changes', 'ran-suite', 'tested-locally', 'tests-pass', 'verified']);
  });
  for (const row of TABLE) {
    describe(row.kind, () => {
      it.each(row.phrasings)('finds %j', (text, matched) => {
        const claims = findClaims(text).filter((c) => c.kind === row.kind);
        expect(claims.map((c) => c.text)).toContain(matched);
        expect(claims.length).toBeGreaterThan(0);
      });
      it.each(row.negations)('does not find %j', (text) => {
        expect(findClaims(text).filter((c) => c.kind === row.kind)).toEqual([]);
      });
    });
  }
});

describe('findClaims details', () => {
  it('skips verified by someone', () => {
    expect(findClaims('Verified by the reviewer')).toEqual([]);
  });
  it('is case insensitive and trims the match to 80 characters', () => {
    expect(findClaims('ALL TESTS PASS').map((c) => c.kind)).toEqual(['tests-pass']);
    const long = findClaims(`tests ${'x'.repeat(10)} pass`);
    expect(long).toEqual([]);
    for (const c of findClaims('all unit tests are now passing and verified')) expect(c.text.length).toBeLessThanOrEqual(80);
  });
  it('respects the negation window and does not look further back', () => {
    expect(findClaims('not sure but all tests pass').map((c) => c.kind)).toContain('tests-pass');
    expect(findClaims("don't verified")).toEqual([]);
    expect(findClaims("doesn't verified")).toEqual([]);
    expect(findClaims("didn't verified")).toEqual([]);
  });
  it('reports a repeated phrase once per kind', () => {
    expect(findClaims('Verified. verified.').filter((c) => c.kind === 'verified')).toHaveLength(1);
  });
  it('returns nothing for empty text', () => {
    expect(findClaims('')).toEqual([]);
  });
});

describe('PR bodies with CRLF line endings', () => {
  // The GitHub API returns PR bodies written in the web editor with CRLF.
  it('finds the same claims in a CRLF body as in an LF one', () => {
    const body = '## Summary\n\nAll tests pass.\n\n- [ ] Added tests for refunds\n- [x] Verified locally\n\n```\nall tests pass\n```\n<!-- CI is green -->\n';
    expect(findClaims(body.replace(/\n/g, '\r\n'))).toEqual(findClaims(body));
    expect(findClaims(body.replace(/\n/g, '\r\n')).map((c) => c.kind).sort()).toEqual(['tests-pass', 'verified']);
  });
});
