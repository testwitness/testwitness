import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fingerprint, shortHash } from './hash.js';

describe('shortHash', () => {
  it('is 16 lowercase hex characters', () => {
    expect(shortHash('hello')).toMatch(/^[0-9a-f]{16}$/);
    expect(shortHash('')).toHaveLength(16);
  });
  it('is deterministic and matches the sha256 prefix', () => {
    expect(shortHash('hello')).toBe(shortHash('hello'));
    expect(shortHash('hello')).toBe('2cf24dba5fb0a30e');
    expect(shortHash('')).toBe('e3b0c44298fc1c14');
  });
  it('differs for different input', () => {
    expect(shortHash('a')).not.toBe(shortHash('b'));
    expect(shortHash('a')).not.toBe(shortHash('a '));
  });
  it('has a fixed length for any input', () => {
    fc.assert(fc.property(fc.string(), (s) => shortHash(s).length === 16));
  });
});

describe('fingerprint', () => {
  it('has no hash suffix when there is no snippet', () => {
    expect(fingerprint('R001', 'a.ts', 'x')).toBe('R001:a.ts:x');
    expect(fingerprint('R001', 'a.ts', 'x', '')).toBe('R001:a.ts:x');
    expect(fingerprint('R001', 'a.ts', 'x', '  \n\t ')).toBe('R001:a.ts:x');
  });
  it('appends the short hash of the normalised snippet', () => {
    expect(fingerprint('R001', 'a.ts', 'x', 'foo bar')).toBe(`R001:a.ts:x:${shortHash('foo bar')}`);
  });
  it('ignores whitespace differences in the snippet', () => {
    const a = fingerprint('R001', 'a.ts', 'x', 'foo   bar\n baz');
    expect(a).toBe(fingerprint('R001', 'a.ts', 'x', 'foo bar baz'));
    expect(a).toBe(fingerprint('R001', 'a.ts', 'x', '\t foo\r\nbar  baz  '));
  });
  it('differs when the snippet words differ', () => {
    expect(fingerprint('R001', 'a.ts', 'x', 'foo bar')).not.toBe(fingerprint('R001', 'a.ts', 'x', 'foo baz'));
    expect(fingerprint('R001', 'a.ts', 'x', 'foobar')).not.toBe(fingerprint('R001', 'a.ts', 'x', 'foo bar'));
  });
  it('differs by rule, path and subject', () => {
    const base = fingerprint('R001', 'a.ts', 'x', 's');
    expect(fingerprint('R002', 'a.ts', 'x', 's')).not.toBe(base);
    expect(fingerprint('R001', 'b.ts', 'x', 's')).not.toBe(base);
    expect(fingerprint('R001', 'a.ts', 'y', 's')).not.toBe(base);
  });
  it('carries rule, path and subject in order', () => {
    expect(fingerprint('A001', 'p/q.ts', 'Sub › name').startsWith('A001:p/q.ts:Sub › name')).toBe(true);
  });
  it('is invariant under whitespace changes in the snippet (property)', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9_().=]{1,8}$/);
    const gap = fc.stringMatching(/^[ \t\r\n]{1,4}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 6 }), fc.array(gap, { minLength: 8, maxLength: 8 }), fc.array(gap, { minLength: 8, maxLength: 8 }), fc.stringMatching(/^[ \t\n]{0,3}$/), (words, gapsA, gapsB, pad) => {
        const join = (gaps: string[]) => words.map((w, i) => (i === 0 ? w : gaps[i]! + w)).join('');
        return fingerprint('R001', 'a.ts', 's', join(gapsA)) === fingerprint('R001', 'a.ts', 's', pad + join(gapsB) + pad);
      }),
    );
  });
});
