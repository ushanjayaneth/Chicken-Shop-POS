import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createFixtureServer} from './fixture-server.mjs';

test.use({serviceWorkers:'allow'});

test('first offline preparation stays open and an accepted worker update preserves the cart',async({page,context})=>{
  const fixture=createFixtureServer();
  let version=1;
  const listener=fixture.server.listeners('request')[0];
  fixture.server.removeAllListeners('request');
  fixture.server.on('request',(request,response)=>{
    if(new URL(request.url,'http://fixture').pathname==='/sw.js'){
      const source=readFileSync('sw.js','utf8').replace(/const CACHE_NAME = '([^']+)'/,(_match,name)=>`const CACHE_NAME = '${name}-fixture-${version}'`);
      response.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/'});
      response.end(source);return;
    }
    listener(request,response);
  });
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.server.address().port}`;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let navigations=0;
  page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;});
  try {
    await page.goto(origin);
    await page.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
    await page.waitForFunction(()=>navigator.serviceWorker.controller&&document.documentElement.dataset.offlineReady==='true');
    await page.waitForTimeout(700);
    expect(navigations).toBe(1);
    expect(await page.evaluate(async()=>Boolean(await caches.match(new URL('pwa.js',location.href))))).toBe(true);
    expect(await page.evaluate(async()=>Boolean(await caches.match(new URL('backup.js',location.href))))).toBe(true);
    expect(await page.locator('#pwaUpdateDialog').evaluate(element=>element.open)).toBe(false);
    await context.setOffline(true);
    const firstOffline=await context.newPage();
    firstOffline.on('pageerror',error=>errors.push(error.message));
    await firstOffline.goto(origin);
    await firstOffline.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
    expect(await firstOffline.evaluate(()=>typeof PWA.setup)).toBe('function');
    expect(await firstOffline.evaluate(()=>typeof BackupStore.restore)).toBe('function');
    await firstOffline.close();
    await context.setOffline(false);
    version=2;
    await page.evaluate(()=>PWA._registration.update());
    await expect(page.locator('#pwaUpdateDialog')).toBeVisible();
    await page.locator('#pwaUpdateLater').click();
    await expect(page.locator('#pwaUpdateDialog')).not.toBeVisible();
    await expect(page.locator('#pwaUpdateButton')).toBeVisible();
    await page.locator('.item-card[onclick="POS.addFlow(\'eggs\')"]').click();
    await page.locator('#pwaUpdateButton').click();
    const navigation=page.waitForNavigation();
    await page.locator('#pwaUpdateNow').click();
    await navigation;
    await page.waitForFunction(()=>S.items.length===4&&S.cart.length===1&&document.getElementById('loader').classList.contains('hide'));
    expect(navigations).toBe(2);
    expect(await page.evaluate(()=>S.cart[0].itemId)).toBe('eggs');
    expect(await page.evaluate(()=>S.sales.length)).toBe(0);
    await context.setOffline(true);
    await page.close();
    const offline=await context.newPage();
    offline.on('pageerror',error=>errors.push(error.message));
    await offline.goto(origin);
    await offline.waitForFunction(()=>S.items.length===4&&S.cart.length===1&&document.getElementById('loader').classList.contains('hide'));
    expect(await offline.evaluate(()=>typeof PWA.setup)).toBe('function');
    expect(await offline.evaluate(()=>S.cart[0].itemId)).toBe('eggs');
    expect(errors).toEqual([]);
  } finally {
    fixture.server.closeAllConnections();
    await new Promise(resolve=>fixture.server.close(resolve));
  }
});
