// action.yml as the GitHub Marketplace reads it: it refuses to list an Action whose description is 125 characters
// or longer (the v0.1.0 release was refused for this).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const text = readFileSync(join(root, 'action.yml'), 'utf8');
// Plain patterns, so the test needs no YAML library. The description must stay a one line scalar: a block scalar
// (| or >) or a quoted value fails here rather than being measured wrongly.
const line = (pattern: RegExp): string => pattern.exec(text)?.[1] ?? '';
const description = line(/^description: (.*)$/m);

describe('action.yml for the Marketplace', () => {
  it('has a plain one line description under 125 characters', () => {
    expect(description).toMatch(/^[^|>'"\s]/);
    expect(description.length).toBeGreaterThan(20);
    expect(description.length).toBeLessThan(125);
  });

  it('keeps the name and branding the Marketplace accepted', () => {
    expect(line(/^name: (.*)$/m)).toBe('testwitness');
    expect(line(/^branding:\n {2}icon: (.*)$/m)).toBe('eye');
    expect(line(/^branding:\n {2}icon: .*\n {2}color: (.*)$/m)).toBe('gray-dark');
  });
});
