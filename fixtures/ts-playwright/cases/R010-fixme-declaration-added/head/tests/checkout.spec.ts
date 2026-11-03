import { expect, test } from '@playwright/test';

test.describe('checkout', () => {
  test('shows the cart total', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByTestId('total')).toHaveText('$13.00');
  });

  test('applies a promo code', async ({ page }) => {
    await page.goto('/cart');
    await page.getByLabel('Promo code').fill('SAVE10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('total')).toHaveText('$11.70');
  });

  test.fixme('handles a 3DS challenge', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByTestId('challenge')).toBeVisible();
  });

  test('rejects an unknown promo code', async ({ page }) => {
    await page.goto('/cart');
    await page.getByLabel('Promo code').fill('NOPE');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert')).toContainText('Unknown code');
  });
});
