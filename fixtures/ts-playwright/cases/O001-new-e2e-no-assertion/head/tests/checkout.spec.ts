import { expect, test } from '@playwright/test';

test.describe('checkout', () => {
  test('applies a promo code', async ({ page }) => {
    await page.goto('/cart');
    await page.getByLabel('Promo code').fill('SAVE10');
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  test('shows the cart total', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByTestId('total')).toHaveText('$13.00');
  });
});
