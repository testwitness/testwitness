// @ts-nocheck
import { expect, test } from '@playwright/test';

test.describe('page basics', () => {
  test('renders inline html', async ({ page }) => {
    await page.setContent('<h1 id="title">Hello</h1>');
    await expect(page.locator('#title')).toHaveText('Hello');
  });

  test('evaluates in the page', async ({ page }) => {
    const sum = await page.evaluate(() => 2 + 4);
    expect(sum).toBe(6);
  });
});
