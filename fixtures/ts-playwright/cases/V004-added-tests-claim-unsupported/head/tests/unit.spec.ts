import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function parsePrice(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ''));
}

const counterFile = path.join(__dirname, '..', '.flaky-counter');

test.describe('pricing', () => {
  test('parses a dollar amount', () => {
    expect(parsePrice('$12.75')).toBe(12.75);
  });

  test('parses a bare number', () => {
    expect(parsePrice('7')).toBe(7);
  });

  test.skip('parses euro amounts', () => {
    expect(parsePrice('12,50 EUR')).toBe(12.5);
  });

  test.fixme('handles negative amounts', () => {
    expect(parsePrice('-3')).toBe(-3);
  });

  test('fails on purpose', () => {
    expect(parsePrice('$1')).toBe(2);
  });

  test('flaky passes on retry', () => {
    const attempts = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
    fs.writeFileSync(counterFile, String(attempts + 1));
    expect(attempts).toBeGreaterThan(0);
  });
});

test('expected to fail', () => {
  test.fail();
  expect(parsePrice('x')).toBe(99);
});
