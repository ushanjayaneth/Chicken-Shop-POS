import {test, expect} from '@playwright/test';
import {createPOSServer} from '../scripts/server.mjs';
import {hasSession} from '../lib/cloud-session.mjs';
import {createPinFixture, signingSecret, testPin} from './workspace-pin-fixture.mjs';

test('a fresh device signs in and keeps its cached workspace when connectivity drops', async ({browser}) => {
  const pinFixture = createPinFixture();
  const item = {name:'Farm eggs',type:'unit',unit:'pcs',price:45,costPrice:35,stockBatches:[{batchId:'e1',quantity:12,costPrice:35}]};
  const server = createPOSServer({session:pinFixture.handler(),api:async (req,res) => {
    if (!hasSession(req.headers.cookie,signingSecret)) return res.status(401).json({error:'Connect this device',code:'CLOUD_SIGN_IN_REQUIRED'});
    return res.status(200).json({items:{eggs:item}});
  }});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const form = page.locator('#cloudAccessModal');
    await expect(form).toBeVisible();
    await expect(page.getByText('Farm eggs', {exact:true})).toHaveCount(0);
    await page.locator('#cloudAccessPin').fill('5678');
    await page.locator('#cloudAccessSubmit').click();
    await expect(page.locator('#cloudAccessError')).toContainText('incorrect');
    await page.locator('#cloudAccessPin').fill('1234');
    await page.locator('#cloudAccessSubmit').click();
    await expect(form).toBeHidden();
    await expect(page.getByText('Farm eggs', {exact:true}).first()).toBeVisible();
    await expect(page.locator('#workspaceSyncText')).toHaveText('Cloud connected');
    const [cookie] = await context.cookies();
    expect(cookie).toMatchObject({httpOnly:true,sameSite:'Strict',path:'/api'});
    await page.getByRole('button',{name:'Settings'}).click();
    await page.locator('#workspaceCurrentPin').fill('1234');
    await page.locator('#workspaceNextPin').fill(testPin);
    await page.locator('#workspaceConfirmPin').fill(testPin);
    await page.locator('#workspacePinSubmit').click();
    await expect(page.locator('#workspacePinStatus')).toHaveText('Workspace PIN updated.');
    const before = await browser.newContext();
    try {
      const first = await before.request.post(origin + '/api/session',{data:{pin:'1234'}});
      expect(first.status()).toBe(401);
      const after = await before.request.post(origin + '/api/session',{data:{pin:testPin}});
      expect(after.status()).toBe(200);
    } finally {await before.close();}
    await page.waitForFunction(() => navigator.serviceWorker.controller && document.documentElement.dataset.offlineReady === 'true');
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('Farm eggs', {exact:true}).first()).toBeVisible();
    await expect(form).toBeHidden();
    await expect(page.locator('#workspaceSyncText')).toHaveText('Cloud offline');
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
