import { describe, expect, it } from 'vitest';
import { toLf } from './eol.js';

describe('toLf', () => {
  it('turns CRLF into LF and keeps the line count', () => {
    const crlf = 'a\r\nb\r\n\r\nc';
    expect(toLf(crlf)).toBe('a\nb\n\nc');
    expect(toLf(crlf).split('\n')).toHaveLength(crlf.split('\n').length);
  });

  it('leaves LF text, a lone CR and a CR inside a line alone', () => {
    expect(toLf('a\nb\n')).toBe('a\nb\n');
    expect(toLf('a\rb\n')).toBe('a\rb\n');
    expect(toLf('a\r\r\nb')).toBe('a\r\nb');
  });

  it('handles mixed line endings in one file', () => {
    expect(toLf('one\r\ntwo\nthree\r\n')).toBe('one\ntwo\nthree\n');
  });
});
