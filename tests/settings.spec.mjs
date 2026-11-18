import {test as base,expect} from '@playwright/test';
import {createFixtureServer} from './fixture-server.mjs';
const test=base.extend({app:[async({page},use)=>{
  const fixture=createFixtureServer();
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.server.address().port}`;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
  await use({...fixture,origin,errors});
  fixture.server.closeAllConnections();
  await new Promise(resolve=>fixture.server.close(resolve));
  expect(errors).toEqual([]);
},{auto:true}]});
const saved=page=>page.evaluate(()=>DB.get('settings/main'));

test('settings preserve other fields and concurrent opening floats while saving zero and fractional thresholds',async({page,app})=>{
  await page.evaluate(()=>Settings.open());
  await page.evaluate(async origin=>DB.patch('settings/main',{openingFloats:{'2026-11-15':3750},coconutOpeningFloats:{'2026-11-15':2500},apiServerUrl:origin,customSetting:'retained'}),app.origin);
  await page.locator('#setName').fill('Chicken House Main Branch');await page.locator('#setLow').fill('0');
  expect(await page.evaluate(()=>Settings.save())).toBe(true);
  let settings=await saved(page);
  expect(settings.shopName).toBe('Chicken House Main Branch');expect(settings.lowStockAlert).toBe(0);
  expect(settings.openingFloats).toEqual({'2026-11-15':3750});expect(settings.coconutOpeningFloats).toEqual({'2026-11-15':2500});expect(settings.apiServerUrl).toBe(app.origin);expect(settings.customSetting).toBe('retained');
  await page.evaluate(()=>Settings.open());
  await expect(page.locator('#setLow')).toHaveValue('0');
  await page.locator('#setLow').fill('.125');
  expect(await page.evaluate(()=>Settings.save())).toBe(true);
  settings=await saved(page);expect(settings.lowStockAlert).toBe(.125);expect(settings.openingFloats['2026-11-15']).toBe(3750);
});

test('invalid settings remain open and stale editable fields cannot replace newer shop settings',async({page})=>{
  const original=await saved(page);
  await page.evaluate(()=>Settings.open());
  await page.locator('#setLow').fill('-1');
  expect(await page.evaluate(()=>Settings.save())).toBe(false);expect((await saved(page)).lowStockAlert).toBe(original.lowStockAlert);
  await page.locator('#setLow').fill('5');await page.locator('#setName').fill('');
  expect(await page.evaluate(()=>Settings.save())).toBe(false);
  await page.locator('#setName').fill('Requested name');
  await page.evaluate(()=>DB.patch('settings/main',{shopName:'Changed on another screen'}));
  expect(await page.evaluate(()=>Settings.save())).toBe(false);
  expect((await saved(page)).shopName).toBe('Changed on another screen');
});

test('admin PIN changes persist immediately, retain leading zeros and survive ordinary settings saves',async({page})=>{
  await page.evaluate(()=>Settings.open());
  await page.locator('#curPin').fill('1234');await page.locator('#newPin').fill('abcd');await page.locator('#confPin').fill('abcd');
  expect(await page.evaluate(()=>Settings.changePin())).toBe(false);expect((await saved(page)).adminPin).toBe('1234');
  await page.locator('#newPin').fill('0066');await page.locator('#confPin').fill('0066');
  expect(await page.evaluate(()=>Settings.changePin())).toBe(true);expect((await saved(page)).adminPin).toBe('0066');
  await page.locator('#setLow').fill('2.5');
  expect(await page.evaluate(()=>Settings.save())).toBe(true);expect((await saved(page)).adminPin).toBe('0066');
  await page.reload();await page.waitForFunction(()=>S.settings.adminPin==='0066');
  await page.evaluate(()=>Settings.open());await page.locator('#curPin').fill('1234');await page.locator('#newPin').fill('9999');await page.locator('#confPin').fill('9999');
  expect(await page.evaluate(()=>Settings.changePin())).toBe(false);expect((await saved(page)).adminPin).toBe('0066');
});

test('barcode labels use the Chicken House prefix and reject invalid prices, counts and unsafe prefixes',async({page})=>{
  await expect(page.locator('#bcPrefix')).toHaveValue('CH');
  await page.evaluate(()=>Nav.go('barcodes'));
  await page.locator('#bcGenCount').fill('5');await page.locator('#bcManualPrice').fill('29.95');
  expect(await page.evaluate(()=>BarcodeTab.generateBatch())).toBe(true);
  const codes=await page.evaluate(()=>BarcodeTab._codes);
  expect(codes).toHaveLength(5);expect(new Set(codes.map(row=>row.code)).size).toBe(5);expect(codes.every(row=>row.code.startsWith('CH')&&row.price==='29.95')).toBe(true);
  await expect(page.locator('#bcA4Preview svg')).toHaveCount(5);
  await expect.poll(()=>page.locator('#bcpv0 rect').count()).toBeGreaterThan(0);
  await page.locator('#bcManualPrice').fill('-2');
  expect(await page.evaluate(()=>BarcodeTab.generateBatch())).toBe(false);
  await page.locator('#bcManualPrice').fill('');await page.locator('#bcGenCount').fill('1.5');
  expect(await page.evaluate(()=>BarcodeTab.generateBatch())).toBe(false);
  await page.locator('#bcGenCount').fill('5');await page.locator('#bcPrefix').fill('<X>');
  expect(await page.evaluate(()=>BarcodeTab.generateBatch())).toBe(false);expect(await page.evaluate(()=>BarcodeTab._codes)).toEqual(codes);
});

test('custom API base validation accepts local HTTP and HTTPS while rejecting credentials and malformed endpoints',async({page})=>{
  const result=await page.evaluate(()=>{
    const valid=['http://localhost:4188','https://example.test/api/','/api/data'];
    const invalid=['javascript:alert(1)','not-a-url','ftp://example.test','https://user:password@example.test','https://example.test/api?x=1','https://example.test/#api'];
    return {valid:valid.map(value=>Settings.apiBase(value)),invalid:invalid.map(value=>{try{Settings.apiBase(value);return false;}catch{return true;}})};
  });
  expect(result.valid[0]).toBe('http://localhost:4188');expect(result.valid[1]).toBe('https://example.test/api');expect(result.valid[2]).toMatch(/\/api\/data$/);expect(result.invalid).toEqual([true,true,true,true,true,true]);
});
