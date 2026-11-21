
import {expect, test, type Page} from '@playwright/test';
import staticPlugin from '@fastify/static';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/app';
import {MemoryMonitorStore} from '../server/monitor/store';

test.use({serviceWorkers: 'allow'});
test.setTimeout(100_000);

const pin = '58291438';
const productName = 'LongProductNameForTheCheckoutAndReturnsPanelWithoutWhitespace';

async function signIn(page: Page, origin: string) {
  await page.context().setOffline(false);
  await page.goto(origin + '/index.html');
  const pinField = page.getByLabel('Staff PIN', {exact: true});
  await expect(pinField).toBeVisible({timeout: 20_000});
  await pinField.fill(pin);
  await page.getByRole('button', {name: 'Open workspace', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1, name: /Point of sale/})).toBeVisible();
}

function navigate(page: Page, label: RegExp) {
  return page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name: label}).click();
}

test('shared POS opens a shift, prints an offline keyboard checkout once and syncs to another device', async ({browser, context, page}) => {
  const monitor = new MemoryMonitorStore();
  const app = await createApp({
    databasePath: ':memory:', seed: true,
    monitor: {store: monitor, env: {CLOUD_POS_PIN: pin, CLOUD_SESSION_SECRET: randomBytes(48).toString('hex')}},
  });
  await app.register(staticPlugin, {root: resolve('dist'), wildcard: false});
  const origin = await app.listen({host: '127.0.0.1', port: 0});
  const second = await browser.newContext({viewport: {width: 1400, height: 900}});
  await page.addInitScript(() => {
    window.print = () => {
      const count = Number(document.documentElement.getAttribute('data-printed') ?? 0);
      document.documentElement.setAttribute('data-printed', String(count + 1));
    };
  });
  try {
    await signIn(page, origin);
    await expect(page.getByText('Offline ready', {exact: true})).toBeVisible({timeout: 25_000});
    await navigate(page, /^Staff & payroll/);
    await expect(page.getByRole('heading', {level: 1, name: /^Staff & payroll/})).toBeVisible();
    await navigate(page, /^Products/);
    await page.getByRole('button', {name: 'Add product', exact: true}).click();
    const product = page.getByRole('dialog', {name: 'Add product', exact: true});
    await product.getByLabel('Product name', {exact: true}).fill(productName);
    await product.getByLabel('Selling price (LKR)', {exact: true}).fill('125');
    await product.getByLabel('Opening stock quantity', {exact: true}).fill('5');
    await product.getByRole('button', {name: 'Add product', exact: true}).click();
    await expect(product).toHaveCount(0);
    await navigate(page, /^Point of sale/);
    const other = await second.newPage();
    let shiftConflictSeen = false;
    await other.route('**/api/cloud?*', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'bootstrap') {
        // Simulate a register with current sales but an outdated cash drawer snapshot.
        url.searchParams.delete('ifVersion');
        const response = await route.fetch({url: url.href});
        const snapshot = await response.json();
        if (!shiftConflictSeen && snapshot.offlineState) {
          snapshot.shifts = [];
          snapshot.offlineState.records = snapshot.offlineState.records.filter((record: {kind: string}) => record.kind !== 'shift');
        }
        return route.fulfill({response, json: snapshot});
      }
      if (url.searchParams.get('action') === 'offline-commit') {
        const response = await route.fetch();
        if (response.status() === 409 && (await response.json()).code === 'SHIFT_ALREADY_OPEN') shiftConflictSeen = true;
        return route.fulfill({response});
      }
      return route.continue();
    });
    await signIn(other, origin);
    await expect(other.getByRole('button', {name: 'Add ' + productName, exact: true})).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', {name: 'Add ' + productName, exact: true}).click();
    await page.keyboard.press('Enter');
    const payment = page.getByRole('dialog', {name: 'Take payment', exact: true});
    await expect(payment.getByLabel('Opening cash float (LKR)')).toHaveValue('0');
    await payment.getByLabel('Opening cash float (LKR)').fill('200');
    await page.keyboard.press('Enter');
    const receipt = page.getByRole('dialog', {name: 'Order receipt', exact: true});
    await expect(receipt).toContainText('125.00');
    await expect(page.locator('html')).toHaveAttribute('data-printed', '1');
    await receipt.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Charge order', exact: true})).toBeDisabled();
    await navigate(page, /^Staff & payroll/);
    await expect(page.getByRole('heading', {level: 1, name: /^Staff & payroll/})).toBeVisible();

    await context.setOffline(false);
    await expect.poll(async () => {
      const workspace = (await monitor.list())[0];
      const data = await monitor.get(workspace.sourceId);
      return Object.values(data?.records ?? {}).filter(row => row.kind === 'order' && row.value.paid === 12500).length;
    }, {timeout: 30_000}).toBe(1);
    await navigate(other, /^Sales & returns/);
    await other.getByRole('button', {name: /^All/}).first().click();
    const line = other.locator('.order-card-items').getByText(productName, {exact: true});
    await expect(line).toBeVisible();
    expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await other.setViewportSize({width: 390, height: 844});
    expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await other.setViewportSize({width: 1400, height: 900});
    await navigate(other, /^Point of sale/);
    await other.getByRole('button', {name: 'Add ' + productName, exact: true}).click();
    await other.keyboard.press('Enter');
    const onlinePayment = other.getByRole('dialog', {name: 'Take payment', exact: true});
    await onlinePayment.getByRole('button', {name: 'Confirm payment', exact: true}).click();
    await expect(other.getByRole('dialog', {name: 'Order receipt', exact: true})).toContainText('125.00');
    expect(shiftConflictSeen).toBe(true);
  } finally {
    await Promise.all(second.pages().map(page => page.unrouteAll({behavior: 'ignoreErrors'})));
    await second.close();
    await app.close();
  }
});
