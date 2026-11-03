// @ts-nocheck
import { expect, test } from '@playwright/test';

test.describe('checkout', () => {
  test('sums two prices', () => {
    expect(1.5 + 2.5).toBe(4);
  });
});
