import {test as base, expect} from '@playwright/test';
import {createFixtureServer} from './fixture-server.mjs';
const test = base.extend({app:[async({page},use)=>{
  const fixture = createFixtureServer();
  fixture.state.items.chicken.stockBatches = {older:fixture.state.items.chicken.stockBatches[0]};
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
  await page.evaluate(()=>{S.adminUnlocked=true;});
  await use({...fixture,origin,errors});
  fixture.server.closeAllConnections();
  await new Promise(resolve=>fixture.server.close(resolve));
  expect(errors).toEqual([]);
},{auto:true}]});
const read = (page,path)=>page.evaluate(path=>DB.get(path),path);
const saveProduct = page=>page.locator('#itemFormBody button[onclick^="ItemForm.save"]').click();

async function newProduct(page) {
  await page.evaluate(()=>ItemForm.open(null));
  await page.locator('#fName').fill('Free range eggs');
  await page.locator('#fPrice').fill('65');
  await page.locator('#fCost').fill('45');
  await page.locator('#fWholesale').fill('60');
  await page.locator('#fBarcode').fill('INV-009');
  await page.locator('#fThresh').fill('0');
  await page.locator('#fInitStock').fill('12');
}

test('product entry persists real cost, wholesale price, zero alert threshold and rejects invalid or duplicate input',async({page})=>{
  await newProduct(page);
  await page.locator('#fCost').fill('-1');
  await saveProduct(page);
  expect(Object.keys(await read(page,'items'))).toHaveLength(4);
  await page.locator('#fCost').fill('45');
  await page.locator('#fInitStock').fill('1.5');
  await saveProduct(page);
  expect(Object.keys(await read(page,'items'))).toHaveLength(4);
  await page.locator('#fInitStock').fill('12');
  await saveProduct(page);
  await expect.poll(async()=>Object.keys(await read(page,'items')).length).toBe(5);
  const item=Object.values(await read(page,'items')).find(item=>item.name==='Free range eggs');
  expect(item.costPrice).toBe(45);expect(item.price).toBe(65);expect(item.wholesalePrice).toBe(60);expect(item.lowStockThreshold).toBe(0);
  expect(item.stockBatches[0].quantity).toBe(12);
  await newProduct(page);
  await saveProduct(page);
  expect(Object.keys(await read(page,'items'))).toHaveLength(5);
});

test('weighted stock receipts accept fractional quantities and legacy batch objects without losing stock',async({page,app})=>{
  await page.evaluate(()=>StockAdd.open('chicken'));
  await page.locator('#saQ').fill('2.125');
  await page.locator('#saC').fill('-5');
  expect(await page.evaluate(()=>StockAdd.confirm('chicken'))).toBe(false);
  expect(Object.values((await read(page,'items/chicken')).stockBatches)).toHaveLength(1);
  await page.locator('#saC').fill('950.25');
  await page.locator('#saD').fill('2026-11-15');
  await page.locator('#discBody button[onclick="StockAdd.confirm(\'chicken\')"]').click();
  await expect.poll(async()=>Object.values((await read(page,'items/chicken')).stockBatches).length).toBe(2);
  const item=await read(page,'items/chicken');
  expect(item.stockBatches[0].quantity).toBe(15);expect(item.stockBatches[1].quantity).toBe(2.125);expect(item.stockBatches[1].costPrice).toBe(950.25);
  await page.evaluate(()=>Sync.flush());
  expect(app.state.items.chicken.stockBatches.reduce((sum,batch)=>sum+batch.quantity,0)).toBe(17.125);
});

test('stock editing records an adjustment reason and does not overwrite intervening sales or metadata changes',async({page})=>{
  await page.evaluate(()=>ItemForm.open('chicken'));
  await page.locator('#fStockCount').fill('12.75');
  expect(await page.evaluate(()=>ItemForm.save('chicken'))).toBe(false);
  await page.locator('#fStockReason').fill('Measured stock count');
  expect(await page.evaluate(()=>ItemForm.save('chicken'))).toBe(true);
  let item=await read(page,'items/chicken');
  expect(item.stockBatches[0].quantity).toBe(12.75);expect(item.stockAdjustments[0].reason).toBe('Measured stock count');
  await page.evaluate(async()=>{ItemForm.open('chicken');const item=await DB.get('items/chicken');const stock=Object.values(item.stockBatches);stock[0].quantity=11.75;await DB.patch('items/chicken',{stockBatches:stock});});
  await page.locator('#fPrice').fill('1300');
  expect(await page.evaluate(()=>ItemForm.save('chicken'))).toBe(true);
  item=await read(page,'items/chicken');expect(item.stockBatches[0].quantity).toBe(11.75);expect(item.price).toBe(1300);
  await page.evaluate(async()=>{ItemForm.open('chicken');await DB.patch('items/chicken',{price:1400});});
  await page.locator('#fPrice').fill('1500');
  expect(await page.evaluate(()=>ItemForm.save('chicken'))).toBe(false);
  expect((await read(page,'items/chicken')).price).toBe(1400);
});

test('product photos support file selection, camera capture and actual removal',async({page})=>{
  await page.evaluate(()=>ItemForm.open('chicken'));
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;const context=canvas.getContext('2d');context.fillStyle='#eab357';context.fillRect(0,0,40,40);return canvas.toDataURL('image/png').split(',')[1];});
  await page.locator('#fImgFile').setInputFiles({name:'product.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await expect.poll(()=>page.evaluate(()=>ItemForm._tempImageDataUrl)).toContain('data:image/png;base64,');
  await expect(page.locator('#imagePreviewContainer')).toBeVisible();
  expect(await page.locator('#fImgCamera').getAttribute('capture')).toBe('environment');
  await saveProduct(page);
  await expect.poll(async()=>(await read(page,'items/chicken')).image).toBe('data:image/png;base64,'+image);
  await page.evaluate(()=>ItemForm.open('chicken'));
  await page.locator('#imagePreviewContainer button').click();
  await saveProduct(page);
  await expect.poll(async()=>(await read(page,'items/chicken')).image).toBeFalsy();
});

test('serial barcode intake rejects duplicate stock and preserves integer unit counts',async({page})=>{
  await page.evaluate(()=>{StockAdd.open('eggs');StockAdd.toggleScanner();StockAdd.handleScan('SERIAL-A');StockAdd.handleScan('SERIAL-B');StockAdd.handleScan('SERIAL-A');});
  await expect(page.locator('#saQ')).toHaveValue('2');
  await page.locator('#saC').fill('36');
  expect(await page.evaluate(()=>StockAdd.confirm('eggs'))).toBe(true);
  const batches=(await read(page,'items/eggs')).stockBatches;
  expect(batches[1].barcodes).toEqual(['SERIAL-A','SERIAL-B']);
  await page.evaluate(()=>{StockAdd.open('eggs');StockAdd.toggleScanner();StockAdd.handleScan('SERIAL-A');});
  await expect(page.locator('#saQ')).toHaveValue('0');
  expect(await page.evaluate(()=>StockAdd.confirm('eggs'))).toBe(false);
  expect((await read(page,'items/eggs')).stockBatches).toHaveLength(2);
});

test('liquid packages validate each option and deduct their measured stock with actual package profit',async({page})=>{
  await page.evaluate(()=>ItemForm.open(null));
  await page.locator('#fName').fill('Fresh coconut oil');
  await page.locator('#fType').selectOption('liquid');
  await page.locator('#fPrice').fill('1000');await page.locator('#fCost').fill('600');
  await page.locator('#fInitStock').fill('5');
  await page.evaluate(()=>ItemForm.addLiqRow('Quarter litre','.25','0'));
  expect(await page.evaluate(()=>ItemForm.save(null))).toBe(false);
  await page.locator('.lo-p').fill('350');
  expect(await page.evaluate(()=>ItemForm.save(null))).toBe(true);
  const [id,item]=Object.entries(await read(page,'items')).find(([,item])=>item.name==='Fresh coconut oil');
  expect(item.unit).toBe('L');expect(item.liquidOptions).toEqual([{label:'Quarter litre',amount:.25,price:350}]);
  await page.evaluate(id=>POS.addFlow(id),id);
  await page.locator('.liq-opt').click();
  expect(await page.evaluate(()=>Checkout.run(true))).toBe(true);
  const sale=Object.values(await read(page,'sales'))[0];
  expect(sale.total).toBe(350);expect(sale.profit).toBe(200);expect(sale.items[0].qty).toBe(.25);
  expect((await read(page,'items/'+id)).stockBatches[0].quantity).toBe(4.75);
});
