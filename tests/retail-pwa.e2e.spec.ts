import {expect, test} from '@playwright/test';

test.use({serviceWorkers: 'allow'});

test('Chicken House is installable from the cloud PIN screen before signing in', async ({page, context}) => {
  await page.route('**/api/cloud?*', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'status') return route.fulfill({json: {configured: true}});
    if (action === 'pos-session') return route.fulfill({json: {authenticated: false}});
    return route.fulfill({status: 401, json: {error: 'Sign in first'}});
  });
  await page.goto('/index.html');
  await expect(page.getByLabel('Staff PIN', {exact: true})).toBeVisible();
  const install = page.getByRole('button', {name: 'Install app', exact: true});
  await expect(install).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');

  const session = await context.newCDPSession(page);
  try {
    expect((await session.send('Page.getAppManifest')).errors).toEqual([]);
    expect((await session.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  } finally {
    await session.detach();
  }

  const browserPromotionAllowed = await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', {cancelable: true});
    Object.defineProperties(event, {
      prompt: {value: async () => document.documentElement.setAttribute('data-install-prompted', 'true')},
      userChoice: {value: Promise.resolve({outcome: 'accepted'})},
    });
    return window.dispatchEvent(event);
  });
  expect(browserPromotionAllowed).toBe(true);
  await install.click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'true');
  await expect(install).toHaveCount(0);
});
