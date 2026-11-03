import { expect, test } from '@playwright/test';

test('formats cents', () => {
  expect((1234 / 100).toFixed(2)).toBe('12.34');
});
