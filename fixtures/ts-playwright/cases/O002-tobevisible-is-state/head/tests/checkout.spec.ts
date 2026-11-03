import { expect, test } from '@playwright/test';

test.describe('checkout', () => {
  test('shows the promo field', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByLabel('Promo code')).toBeVisible();
  });

  test('shows the cart total', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByTestId('total')).toHaveText('$13.00');
  });
});
