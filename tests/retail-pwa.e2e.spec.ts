import {chromium, expect, test, type BrowserContext} from '@playwright/test';
import staticPlugin from '@fastify/static';
import {randomBytes} from 'node:crypto';
import {basename, dirname, join, resolve} from 'node:path';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createApp} from '../server/app';
import {MemoryMonitorStore} from '../server/monitor/store';

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

test('a prepared cloud POS reopens from the installed start address and accepts its PIN offline', async () => {
  test.setTimeout(90_000);
  const pin = '58291634';
  const monitor = new MemoryMonitorStore();
  const app = await createApp({databasePath: ':memory:', seed: true, monitor: {
    store: monitor, env: {CLOUD_POS_PIN: pin, CLOUD_SESSION_SECRET: randomBytes(48).toString('hex')},
  }});
  const temp = resolve(tmpdir());
  const prefix = 'ch-pos-';
  const profile = await mkdtemp(join(temp, prefix));
  let context: BrowserContext | undefined;
  let onlineLogins = 0;
  let workerAttempts = 0;
  app.addHook('onRequest', async (request, reply) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.searchParams.get('action') === 'pos-login') onlineLogins++;
    if (url.pathname === '/sw.js' && ++workerAttempts === 1) {
      await reply.code(503).send('First worker request interrupted');
      return;
    }
    if (url.pathname.endsWith('.woff2') || url.pathname.endsWith('.svg')) {
      await reply.code(503).send('Optional asset temporarily unavailable');
    }
  });
  await app.register(staticPlugin, {root: resolve('dist'), wildcard: false});
  const origin = await app.listen({host: '127.0.0.1', port: 0});
  const open = async (offline: boolean) => {
    await context?.close();
    context = await chromium.launchPersistentContext(profile, {
      offline, headless: true, channel: process.env.PLAYWRIGHT_CHANNEL,
      viewport: {width: 1440, height: 900}, serviceWorkers: 'allow',
    });
    return context.pages()[0] ?? await context.newPage();
  };
  try {
    let page = await open(false);
    await page.goto(origin + '/index.html');
    await page.getByLabel('Staff PIN', {exact: true}).fill(pin);
    await page.getByRole('button', {name: 'Open workspace', exact: true}).click();

    await expect(page.getByRole('heading',{level:1,name:/Point of sale/})).toBeVisible();
    await expect(page.getByText('Offline ready', {exact: true})).toBeVisible({timeout: 20000});
    expect(onlineLogins).toBe(1);
    expect(workerAttempts).toBeGreaterThan(1);
    await page.evaluate(() => localStorage.removeItem('retail-cloud-configured'));

    page = await open(true);
    await page.goto(origin + '/');
    await expect(page.getByRole('heading', {level: 1, name: /Point of sale/})).toBeVisible();
    await expect(page.locator('.notice-banner')).toContainText('Working offline');
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    const field = page.getByLabel('Staff PIN', {exact: true});
    await expect(field).toBeVisible();

    // An explicit shared address exercises offline sign-in without a second navigation.
    await page.goto(origin + '/?shared=main-store');
    let navigations = 0;
    page.on('request', request => { if (request.isNavigationRequest()) navigations++; });
    await field.fill('12345678');
    await page.getByRole('button', {name: 'Open workspace', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('The staff PIN is incorrect.');
    await field.fill(pin);
    await page.getByRole('button', {name: 'Open workspace', exact: true}).click();
    await expect(page.getByRole('heading', {level: 1, name: /Point of sale/})).toBeVisible();
    expect(onlineLogins).toBe(1);
    expect(navigations).toBe(0);
  } finally {
    await context?.close();
    await app.close();
    if (dirname(profile) !== temp || !basename(profile).startsWith(prefix)) throw new Error('Unexpected profile path');
    await rm(profile, {recursive: true, force: true});
  }
});
