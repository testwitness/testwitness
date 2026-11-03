/** Shared helpers for the lang-ts test suite. Not a test file itself. */

import type { FrameworkProfile, TestCase, TestInventory } from '@testwitness/core';
import { buildInventory } from './inventory.js';

export const emptyProfile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };

export async function inv(source: string, path = 'src/example.test.ts', profile: FrameworkProfile = emptyProfile): Promise<TestInventory> {
  return buildInventory(path, source, profile);
}

export async function single(source: string, path = 'src/example.test.ts', profile: FrameworkProfile = emptyProfile): Promise<TestCase> {
  const inventory = await inv(source, path, profile);
  if (inventory.tests.length !== 1) {
    throw new Error(`expected one test, got ${inventory.tests.length}: ${inventory.tests.map((t) => t.qualifiedName).join(', ')}`);
  }
  return inventory.tests[0]!;
}

export function byName(inventory: TestInventory, name: string): TestCase {
  const t = inventory.tests.find((x) => x.name === name || x.qualifiedName === name);
  if (!t) throw new Error(`no test named ${name}; have ${inventory.tests.map((x) => x.qualifiedName).join(', ')}`);
  return t;
}

/** Strip common leading indentation so inline sources read well. */
export function src(text: string): string {
  const lines = text.replace(/^\n/, '').split('\n');
  const indents = lines.filter((l) => l.trim().length > 0).map((l) => l.match(/^\s*/)![0].length);
  const min = Math.min(...indents);
  return lines.map((l) => l.slice(min)).join('\n');
}
