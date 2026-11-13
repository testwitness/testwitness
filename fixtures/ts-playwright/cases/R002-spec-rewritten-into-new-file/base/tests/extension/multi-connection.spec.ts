import { expect, test } from './fixtures';

test('shows both connections on the status page', async ({ page, connect }) => {
  await connect('one');
  await connect('two');
  await page.goto('/status');
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

test('drops a connection from the status page when it closes', async ({ page, connect }) => {
  const one = await connect('one');
  await one.close();
  await page.goto('/status');
  await expect(page.getByRole('listitem')).toHaveCount(0);
});
