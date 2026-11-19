import {test, expect, type Page} from '@playwright/test';

test.setTimeout(120000);
test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'allow'});

async function setup(page: Page) {
  await page.goto('/?local=1');
  await page.getByRole('button', {name: 'Create your store', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Set up this device', exact: true});
  await dialog.getByLabel(/^Owner PIN/).fill('98765432');
  await dialog.getByLabel('Confirm owner PIN', {exact: true}).fill('98765432');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', {name: 'Create device workspace', exact: true}).click();
  await expect(page.locator('.product-card')).toHaveCount(18);
}

async function records(page: Page, kind: string): Promise<any[]> {
  return page.evaluate(kind => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('demo-mart-local-workspace-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('records');
      const rows = transaction.objectStore('records').getAll();
      transaction.oncomplete = () => {
        db.close();
        resolve(rows.result.filter(row => row.kind === kind).map(row => row.value));
      };
      transaction.onerror = () => {db.close();reject(transaction.error);};
    };
  }), kind);
}

async function payCash(page: Page) {
  const mobileCart = page.locator('.mobile-cart-button');
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page.getByRole('button', {name: 'Charge order', exact: true}).click();
  const payment = page.getByRole('dialog', {name: 'Take payment', exact: true});
  await payment.getByRole('button', {name: 'Confirm payment', exact: true}).click();
  return page.getByRole('dialog', {name: 'Order receipt', exact: true});
}

test('grams and kilograms quote correctly and save the same canonical stock quantity', async ({page}) => {
  await setup(page);
  await page.getByRole('button', {name: 'Add White sugar', exact: true}).click();
  const quantity = page.getByRole('dialog', {name: 'Item quantity', exact: true});
  await quantity.getByLabel('Unit', {exact: true}).selectOption('g');
  await quantity.getByLabel('Weight', {exact: true}).fill('100');
  await expect(quantity.getByLabel('Calculated quantity')).toHaveText('0.1 kg');
  await expect(quantity.getByLabel('Calculated total')).toHaveText('Rs. 30.00');
  await quantity.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page.locator('.order-total')).toContainText('30.00');
  await page.getByRole('button', {name: 'Enter quantity for White sugar', exact: true}).click();
  await quantity.getByLabel('Unit', {exact: true}).selectOption('g');
  await quantity.getByLabel('Weight', {exact: true}).fill('100.5');
  await quantity.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(quantity.getByRole('alert')).toContainText('steps of 1 g');
  await quantity.getByLabel('Unit', {exact: true}).selectOption('kg');
  await quantity.getByLabel('Weight', {exact: true}).fill('0.5');
  await expect(quantity.getByLabel('Calculated total')).toHaveText('Rs. 150.00');
  await quantity.getByLabel('Weight', {exact: true}).press('Enter');
  await expect(quantity).toHaveCount(0);
  const receipt = await payCash(page);
  await expect(receipt).toContainText('150.00');
  const orders = await records(page, 'order');
  expect(orders).toHaveLength(1);
  expect(orders[0].lines[0].quantity).toBe(.5);
  expect(orders[0].lines[0].saleUnit).toBe('kg');
  expect(orders[0].total).toBe(15000);
  expect((await records(page, 'inventory')).find(row => row.menuItemId === 'm2').quantity).toBe(47.5);
});

test('amount entry displays rounding and uses the selected wholesale price on the saved bill', async ({page}) => {
  await setup(page);
  await page.getByRole('button', {name: 'Add White sugar', exact: true}).click();
  const quantity = page.getByRole('dialog', {name: 'Item quantity', exact: true});
  await quantity.getByRole('tab', {name: 'Amount', exact: true}).click();
  await quantity.getByLabel('Amount (LKR)', {exact: true}).fill('100');
  await expect(quantity.getByLabel('Calculated quantity')).toHaveText('0.333 kg');
  await expect(quantity.getByLabel('Calculated total')).toHaveText('Rs. 99.90');
  await expect(quantity).toContainText('Rs. 0.10 below the entered amount');
  await quantity.getByRole('button', {name: 'Apply', exact: true}).click();
  await page.getByRole('group', {name: 'Selling price mode'}).getByRole('button', {name: /Wholesale/}).click();
  await page.getByRole('button', {name: 'Enter quantity for White sugar', exact: true}).click();
  await quantity.getByRole('tab', {name: 'Amount', exact: true}).click();
  await quantity.getByLabel('Amount (LKR)', {exact: true}).fill('141');
  await expect(quantity.getByLabel('Calculated quantity')).toHaveText('0.5 kg');
  await expect(quantity.getByLabel('Calculated total')).toHaveText('Rs. 141.00');
  await quantity.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(await payCash(page)).toContainText('141.00');
  const order = (await records(page, 'order'))[0];
  expect(order.priceMode).toBe('wholesale');
  expect(order.lines[0].unitPrice).toBe(28200);
  expect(order.lines[0].quantity).toBe(.5);
  expect(order.total).toBe(14100);
});

test('a phone sells 100 grams offline using touch keys and retains stock after reopening', async ({page, context}) => {
  await page.setViewportSize({width: 390, height: 844});
  await setup(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  const photoSources = await page.locator('.product-card img').evaluateAll(images => images.map(image => image.getAttribute('src')!));
  expect(photoSources).toHaveLength(18);
  expect(photoSources.every(source => source.endsWith('.jpg'))).toBe(true);
  const photosCached = await page.evaluate(async sources => Promise.all(sources.map(async source => {
    const response = await fetch(source, {cache: 'reload'});
    return response.ok && (await response.arrayBuffer()).byteLength > 0;
  })), photoSources);
  expect(photosCached.every(Boolean)).toBe(true);
  await page.getByRole('button', {name: 'Add White sugar', exact: true}).click();
  const quantity = page.getByRole('dialog', {name: 'Item quantity', exact: true});
  await quantity.getByLabel('Unit', {exact: true}).selectOption('g');
  await quantity.getByRole('button', {name: 'Clear', exact: true}).click();
  for (const digit of '100') await quantity.getByRole('button', {name: digit, exact: true}).click();
  await expect(quantity.getByLabel('Calculated total')).toHaveText('Rs. 30.00');
  await expect(quantity.getByRole('button', {name: 'Apply', exact: true})).toBeInViewport();
  await page.screenshot({path: 'artifacts/measured-sale-mobile.png'});
  await quantity.getByRole('button', {name: 'Apply', exact: true}).click();
  const receipt = await payCash(page);
  await expect(receipt).toContainText('30.00');
  await receipt.getByRole('button', {name: 'Close', exact: true}).click();
  const reopened = await context.newPage();
  await reopened.goto('/?local=1');
  await expect(reopened.locator('.product-card')).toHaveCount(18);
  const orders = await records(reopened, 'order');
  expect(orders).toHaveLength(1);
  expect(orders[0].lines[0].quantity).toBe(.1);
  expect(orders[0].total).toBe(3000);
  expect((await records(reopened, 'inventory')).find(row => row.menuItemId === 'm2').quantity).toBe(47.9);
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});test('the compact catalog keeps the first products visible before scrolling', async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL, hasTouch: true});
  try {
    const page = await context.newPage();
    await setup(page);
    const screens = [
      {width: 1920, height: 1080, visible: 16},
      {width: 1366, height: 768, visible: 16},
      {width: 1280, height: 720, visible: 16},
      {width: 1024, height: 600, visible: 16},
      {width: 768, height: 1024, visible: 16},
      {width: 390, height: 844, visible: 8},
      {width: 360, height: 640, visible: 6},
    ];
    for (const {width, height, visible} of screens) {
      await page.setViewportSize({width, height});
      await expect.poll(() => page.evaluate(count => {
        window.scrollTo(0, 0);
        const cart = document.querySelector('.mobile-cart-button');
        const bottom = cart?.getClientRects().length ? cart.getBoundingClientRect().top : window.innerHeight;
        return [...document.querySelectorAll('.product-card')].slice(0, count).filter(card => {
          const rect = card.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= bottom && rect.left >= 0 && rect.right <= window.innerWidth;
        }).length;
      }, visible), {message: 'Fully visible products at ' + width + '×' + height}).toBe(visible);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }

    await page.setViewportSize({width: 768, height: 1024});
    await page.getByRole('button', {name: 'Add Cream biscuits', exact: true}).click();
    await page.getByRole('button', {name: /View order/}).click();
    const cart = page.getByRole('complementary', {name: 'Current order'});
    await expect(cart.getByText('Cream biscuits', {exact: true})).toBeVisible();
    await cart.getByRole('button', {name: 'Close order', exact: true}).click();
    await expect(cart).toBeHidden();
  } finally {
    await context.close();
  }
});
