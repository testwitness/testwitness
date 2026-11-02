import { describe, expect, it } from 'vitest';
import { byName, inv, single, src } from './helpers.test-util.js';

describe('playwright declarations', () => {
  it('detects playwright and builds names from test.describe', async () => {
    const inventory = await inv(src(`
      import { test, expect } from '@playwright/test';
      test.describe('Login', () => {
        test.describe.serial('flow', () => {
          test('shows the form', async ({ page }) => {
            await page.goto('/login');
            await expect(page.getByRole('form')).toBeVisible();
          });
        });
        test('rejects bad password', async ({ page }) => {
          await page.fill('#pw', 'x');
          await expect(page.getByText('Invalid')).toHaveText('Invalid password');
          await expect(page).toHaveURL(/login/);
        });
      });
    `), 'e2e/login.spec.ts');
    expect(inventory.framework).toBe('playwright');
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual(['Login › flow › shows the form', 'Login › rejects bad password']);
    const t = byName(inventory, 'rejects bad password');
    expect(t.assertions.map((a) => [a.callee, a.kind, a.family, a.strength, a.subject, a.expected])).toEqual([
      ['expect.toHaveText', 'state', 'web', 3, "page.getByText('Invalid')", "'Invalid password'"],
      ['expect.toHaveURL', 'state', 'web', 3, 'page', '/login/'],
    ]);
    expect(t.statementCount).toBe(3);
  });

  it('reads declaration modifiers skip, only, fixme, fail and the tags object form', async () => {
    const inventory = await inv(src(`
      import { test, expect } from '@playwright/test';
      test.skip('a', async ({ page }) => {});
      test.only('b', async ({ page }) => {});
      test.fixme('c', async ({ page }) => {});
      test.fail('d', async ({ page }) => { expect(1).toBe(2); });
      test('e', { tag: ['@slow', '@auth'] }, async ({ page }) => { await expect(page).toHaveTitle('x'); });
      test('f', { annotation: { type: 'issue', description: 'ORG-1' } }, async ({ page }) => {});
      test.describe.skip('g', () => { test('inner', async () => {}); });
      test.describe.only('h', () => { test('inner2', async () => {}); });
      test.describe.fixme('i', () => { test('inner3', async () => {}); });
    `), 'tests/a.spec.ts');
    const m = (name: string) => byName(inventory, name).markers.map((x) => `${x.marker}:${x.kind}`);
    expect(m('a')).toEqual(['test.skip:skip']);
    expect(m('b')).toEqual(['test.only:focus']);
    expect(m('c')).toEqual(['test.fixme:fixme']);
    expect(m('d')).toEqual(['test.fail:xfail']);
    expect(m('e')).toEqual([]);
    expect(byName(inventory, 'e').assertions).toHaveLength(1);
    expect(m('f')).toEqual([]);
    expect(m('inner')).toEqual(['test.describe.skip:skip']);
    expect(m('inner2')).toEqual(['test.describe.only:focus']);
    expect(m('inner3')).toEqual(['test.describe.fixme:fixme']);
  });

  it('reads inline test.skip, test.fixme, test.fail and test.slow inside bodies', async () => {
    const inventory = await inv(src(`
      import { test, expect } from '@playwright/test';
      test('unconditional', async ({ page }) => {
        test.skip();
        await expect(page).toHaveTitle('x');
      });
      test('literal true', async ({ page }) => {
        test.skip(true, 'broken since v2');
      });
      test('by browser', async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', 'not on webkit');
        test.fixme(browserName === 'firefox', 'flaky');
        test.fail(true);
        test.slow();
        await expect(page).toHaveTitle('x');
      });
      test('with reason only', async () => {
        test.fixme('needs backend');
      });
      test('under an if', async ({ page, browserName }) => {
        if (browserName === 'webkit') test.fail();
        if (process.env.CI) {
          test.skip('no fixtures on ci');
        }
        await expect(page).toHaveTitle('x');
      });
    `), 'tests/b.spec.ts');
    const m = (name: string) => byName(inventory, name).markers.map((x) => `${x.marker}:${x.kind}:${x.constant}:${x.reason ?? ''}`);
    expect(m('unconditional')).toEqual(['test.skip:skip:true:']);
    expect(m('literal true')).toEqual(['test.skip:conditional-skip:true:broken since v2']);
    expect(m('by browser')).toEqual([
      'test.skip:conditional-skip:false:not on webkit',
      'test.fixme:fixme:false:flaky',
      'test.fail:xfail:true:',
    ]);
    expect(m('with reason only')).toEqual(['test.fixme:fixme:true:needs backend']);
    expect(m('under an if')).toEqual(['test.fail:xfail:false:', 'test.skip:conditional-skip:false:no fixtures on ci']);
    expect(byName(inventory, 'by browser').statementCount).toBe(5);
  });

  it('applies describe level and file level inline skips to every test they cover', async () => {
    const inventory = await inv(src(`
      import { test, expect } from '@playwright/test';
      test.skip(({ browserName }) => browserName === 'firefox', 'firefox later');
      test.describe('group', () => {
        test.skip(process.env.NO_GROUP === '1', 'env');
        test('one', async () => {});
      });
      test('two', async () => {});
    `), 'tests/c.spec.ts');
    expect(inventory.fileMarkers.map((x) => `${x.marker}:${x.kind}:${x.constant}:${x.reason}`)).toEqual(['test.skip:conditional-skip:false:firefox later']);
    expect(byName(inventory, 'one').markers.map((x) => x.reason)).toEqual(['firefox later', 'env']);
    expect(byName(inventory, 'two').markers.map((x) => x.reason)).toEqual(['firefox later']);
  });

  it('ignores hooks, steps, use and configure and classifies web matchers', async () => {
    const inventory = await inv(src(`
      import { test, expect } from '@playwright/test';
      test.use({ locale: 'en-GB' });
      test.describe.configure({ mode: 'parallel', retries: 2 });
      test.beforeEach(async ({ page }) => { await page.goto('/'); });
      test('steps', async ({ page }) => {
        await test.step('open', async () => {
          await expect(page.locator('h1')).toContainText('Home');
        });
        await expect(page.locator('.item')).toHaveCount(3);
        await expect(page.locator('#cb')).toBeChecked();
        await expect(page.locator('#x')).not.toBeVisible();
        await expect(page.locator('#x')).toBeAttached();
        await expect(page).toHaveScreenshot();
        expect(response.ok()).toBeTruthy();
        await expect(response).toBeOK();
      });
    `), 'tests/d.spec.ts');
    expect(inventory.tests.map((t) => t.name)).toEqual(['steps']);
    const t = inventory.tests[0]!;
    expect(t.assertions.map((a) => `${a.callee} ${a.kind} ${a.strength}`)).toEqual([
      'expect.toContainText state 2',
      'expect.toHaveCount state 3',
      'expect.toBeChecked state 2',
      'expect.not.toBeVisible state 2',
      'expect.toBeAttached state 1',
      'expect.toHaveScreenshot snapshot 1',
      'expect.toBeTruthy smoke 1',
      'expect.toBeOK smoke 1',
    ]);
  });

  it('detects playwright from the page fixture when there is no import', async () => {
    const t = await single(`test('home', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/Home/); });`, 'x.spec.ts');
    expect(t.framework).toBe('playwright');
  });
});
