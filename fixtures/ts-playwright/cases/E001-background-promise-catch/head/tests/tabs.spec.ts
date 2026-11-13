import { expect, test } from './fixtures';

test.describe('tabs', () => {
  test('opens a tab', async ({ client }) => {
    await client.openTab('Alpha');
    await expect.poll(() => client.tabCount()).toBe(1);
  });

  test('releases a pending attach when the client leaves', async ({ client, server }) => {
    void client.openTab('Beta').catch(() => {});
    await expect.poll(() => server.pendingAttaches()).toBe(1);
    await client.close();
    await expect.poll(() => server.pendingAttaches()).toBe(0);
  });
});
