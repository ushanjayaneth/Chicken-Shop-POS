import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createFixtureServer} from './fixture-server.mjs';

test('offline backup export and file restore preserve drafts and replace obsolete pending writes', async({page,context},testInfo) => {
  const fixture=createFixtureServer();
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.server.address().port}`;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  try {
    await page.goto(origin);
    await page.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
    await context.setOffline(true);
    await page.locator('.item-card[onclick="POS.addFlow(\'eggs\')"]').click();
    await page.locator('#checkoutBtn').click();
    await expect(page.locator('#receiptModal')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await page.locator('.item-card[onclick="POS.addFlow(\'eggs\')"]').click();
    await page.evaluate(async()=>{S.heldSales=[{id:'saved-hold',cart:[{itemId:'eggs',qty:1,price:45}],date:new Date().toISOString()}];await Drafts.save();Settings.open();});
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#settingsModal button[onclick="Backup.export()"]' ).click();
    const download=await downloadPromise;
    const path=testInfo.outputPath('complete-backup.json');
    await download.saveAs(path);
    const text=await readFile(path,'utf8');
    const backup=JSON.parse(text);
    expect(backup.format).toBe('mr-chicken-house-backup');
    expect(backup.pendingQueue).toHaveLength(1);
    expect(backup.cache.find(row=>row.path==='sales').data).toBeTruthy();
    await page.evaluate(async()=>{await DB.set('sales/obsolete',{total:999,profit:999,date:new Date().toISOString()});S.cart=[];S.heldSales=[];await Drafts.save();});
    await page.locator('#backupUpload').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(text)});
    await expect.poll(()=>page.evaluate(()=>Object.keys(S.sales).length)).toBe(1);
    expect(await page.evaluate(()=>S.sales.some(row=>row.id==='obsolete'))).toBe(false);
    expect(await page.evaluate(()=>S.cart.length)).toBe(1);
    expect(await page.evaluate(()=>S.heldSales[0].id)).toBe('saved-hold');
    expect(await page.evaluate(()=>IDB.queueCount())).toBe(1);
    expect(await page.evaluate(async()=>(await IDB.queueGetAll())[0].data['sales/obsolete'])).toBeUndefined();
    await context.setOffline(false);
    await page.evaluate(()=>Sync.pull());
    expect(Object.keys(fixture.state.sales)).toHaveLength(1);
    expect(fixture.state.sales.obsolete).toBeUndefined();
    expect(fixture.state.items.eggs.stockBatches[0].quantity).toBe(59);
    expect(errors).toEqual([]);
  } finally {
    fixture.server.closeAllConnections();
    await new Promise(resolve=>fixture.server.close(resolve));
  }
});
