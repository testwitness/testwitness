import { describe, expect, it } from 'vitest';
import { defaultFormat, useColor } from './check.js';

describe('defaultFormat', () => {
  it('is text at a terminal and markdown for pipes and files', () => {
    expect(defaultFormat({ isTTY: true })).toBe('text');
    expect(defaultFormat({ isTTY: false })).toBe('markdown');
    expect(defaultFormat({ isTTY: true, out: 'r.md' })).toBe('markdown');
  });
  it('keeps an explicit format and refuses an unknown one', () => {
    expect(defaultFormat({ format: 'json', isTTY: true })).toBe('json');
    expect(defaultFormat({ format: 'text', isTTY: false })).toBe('text');
    expect(() => defaultFormat({ format: 'html', isTTY: true })).toThrow(
      /--format must be/,
    );
  });
});

describe('useColor', () => {
  it('colours a terminal unless NO_COLOR is set or TERM is dumb', () => {
    expect(useColor({}, true)).toBe(true);
    expect(useColor({}, false)).toBe(false);
    expect(useColor({ NO_COLOR: '1' }, true)).toBe(false);
    expect(useColor({ NO_COLOR: '' }, true)).toBe(true);
    expect(useColor({ TERM: 'dumb' }, true)).toBe(false);
  });
});
