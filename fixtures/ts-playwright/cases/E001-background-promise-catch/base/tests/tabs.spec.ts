import { expect, test } from './fixtures';

test.describe('tabs', () => {
  test('opens a tab', async ({ client }) => {
    await client.openTab('Alpha');
    await expect.poll(() => client.tabCount()).toBe(1);
  });
});
