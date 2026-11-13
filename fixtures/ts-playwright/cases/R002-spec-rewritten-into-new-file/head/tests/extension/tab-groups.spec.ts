import { expect, test } from './fixtures';

test('gives each client its own tab group', async ({ connect }) => {
  const one = await connect('one');
  const two = await connect('two');
  expect(await one.groupId()).not.toBe(await two.groupId());
});

test('resumes a tab group after a reconnect', async ({ connect }) => {
  const one = await connect('one');
  const id = await one.groupId();
  await one.reconnect();
  expect(await one.groupId()).toBe(id);
});

test('releases the group when the client leaves', async ({ connect, browser }) => {
  const one = await connect('one');
  await one.close();
  await expect.poll(() => browser.groupCount()).toBe(0);
});
