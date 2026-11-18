
import {test, expect} from '@playwright/test';
import {createFixtureServer} from './fixture-server.mjs';

test('phone bills offline, preserves the receipt on reopen, and shares both devices’ sales', async ({browser}) => {
  const app = createFixtureServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const phone = await browser.newContext({viewport:{width:360,height:800}, isMobile:true, hasTouch:true, serviceWorkers:'allow'});
  const desktop = await browser.newContext({viewport:{width:1440,height:900}});
  const errors = [];
  const watch = context => context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  watch(phone);
  watch(desktop);
  const addEggs = page => page.getByRole('button', {name:'Add to cart Farm eggs'}).click();
  try {
    let page = await phone.newPage();
    const counter = await desktop.newPage();
    await Promise.all([page.goto(origin), counter.goto(origin)]);
    await page.waitForFunction(() => S.items.length === 4 && document.documentElement.dataset.offlineReady === 'true');
    await counter.waitForFunction(() => S.items.length === 4);
    await phone.setOffline(true);
    await expect(page.locator('#workspaceNetwork')).toContainText('Offline');
    await addEggs(page);
    await page.locator('#mobileCartBtn').click();
    await page.locator('#paymentOptionsBtn').click();
    await page.locator('#checkoutPayMethod').selectOption('card');
    await page.locator('#confirmCheckoutBtn').click();
    await expect(page.locator('#receiptModal')).toBeVisible();
    const [sale] = await page.evaluate(async () => Object.values(await DB.get('sales')));
    expect(sale).toMatchObject({payMethod:'card',total:45,profit:10});
    expect(sale.receiptText).toContain('Farm eggs');
    expect(await page.evaluate(() => S.cart.length)).toBe(0);
    expect(await page.evaluate(() => IDB.queueCount())).toBe(1);
    expect(Object.keys(app.state.sales)).toHaveLength(0);

    await addEggs(counter);
    await counter.locator('#checkoutBtn').click();
    await expect(counter.locator('#receiptModal')).toBeVisible();
    await expect.poll(() => Object.keys(app.state.sales).length).toBe(1);

    await page.close();
    page = await phone.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => S.sales.length === 1 && S.items.length === 4);
    expect(await page.evaluate(() => S.sales[0].receiptText)).toBe(sale.receiptText);
    await expect(page.locator('#workspaceSyncText')).toHaveText('Cloud offline');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await phone.setOffline(false);
    await expect.poll(() => Object.keys(app.state.sales).length).toBe(2);
    await page.waitForFunction(() => S.sales.length === 2 && S.items.find(item=>item.id==='eggs').stockBatches[0].quantity === 58);
    await expect.poll(() => counter.evaluate(() => S.sales.length)).toBe(2, {timeout:16000});
    expect(app.state.items.eggs.stockBatches[0].quantity).toBe(58);
    expect(await page.evaluate(() => IDB.queueCount())).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([phone.close(), desktop.close()]);
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
  }
});
