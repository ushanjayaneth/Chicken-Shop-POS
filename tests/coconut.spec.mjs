import {test as base,expect} from '@playwright/test';
import {createFixtureServer} from './fixture-server.mjs';
const test=base.extend({app:[async({page},use)=>{
  const fixture=createFixtureServer();
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.server.address().port}`;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('2.5'):dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>S.items.length===4&&document.getElementById('loader').classList.contains('hide'));
  await page.evaluate(()=>Nav.go('coconut'));
  await use({...fixture,origin,errors});
  fixture.server.closeAllConnections();
  await new Promise(resolve=>fixture.server.close(resolve));
  expect(errors).toEqual([]);
},{auto:true}]});
const rows=(page,path)=>page.evaluate(path=>DB.get(path),path);
const records=async(page,path)=>Object.entries(await rows(page,path)||{}).map(([id,row])=>({id,...row}));
async function fill(page,values){for(const[id,value]of Object.entries(values))await page.locator('#'+id).fill(String(value));}
async function purchase(page,{count=100,price=100,method='bank',transport=0}={}){
  await page.locator('#ccTab_buy').click();
  await fill(page,{ccBuyEstate:'Test Estate',ccBuyLargeCount:count,ccBuyLargePrice:price,ccBuyTransport:transport});
  await page.locator('#ccBuyPayMethod').selectOption(method);
  await page.getByRole('button',{name:'Save Purchase',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_purchases')).length).toBe(1);
  return (await records(page,'coconut_purchases'))[0];
}
async function worker(page){
  await page.locator('#ccTab_payroll').click();
  await fill(page,{ccWorkerName:'Worker One',ccWorkerPhone:'0771234567'});
  await page.getByRole('button',{name:'Add Worker',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_workers')).length).toBe(1);
  return (await records(page,'coconut_workers'))[0];
}
async function husk(page,{count=50,rate=3,paid=0}={}){
  await page.locator('#ccTab_processing').click();
  await fill(page,{ccHuskLargeCount:count,ccHuskRate:rate,ccHuskPaidDrawer:paid});
  await page.getByRole('button',{name:'Save Husking',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_husking')).length).toBe(1);
  return (await records(page,'coconut_husking'))[0];
}
async function copra(page){
  await fill(page,{ccCopraNuts:20,ccCopraKg:5,ccCopraCost:25.50,ccCopraPaidDrawer:10.25});
  await page.getByRole('button',{name:'Save Copra Registry',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_copra')).length).toBe(1);
  return (await records(page,'coconut_copra'))[0];
}
async function sale(page,{type,qty,price,method='cash',transport=0,transportPaid=0}){
  const before=(await records(page,'coconut_sales')).length;
  await page.locator('#ccTab_sale').click();
  await page.locator('#ccSaleType').selectOption(type);
  await fill(page,{ccSaleBuyer:'Buyer One',ccSaleCount:qty,ccSalePrice:price,ccSaleTransport:transport,ccSaleTransportPaidDrawer:transportPaid});
  await page.locator('#ccSalePayMethod').selectOption(method);
  await page.getByRole('button',{name:'Save Sale',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_sales')).length).toBe(before+1);
  return (await records(page,'coconut_sales')).at(-1);
}

test('coconut production, cash and noncash sales, printable vouchers, payroll and closing stay consistent',async({page,app})=>{
  const buy=await purchase(page,{method:'cash',transport:25.75});
  expect(buy.total).toBe(10025.75);expect(buy.paidDrawer).toBe(10025.75);
  const workerRow=await worker(page);
  await husk(page,{paid:40.25});
  await copra(page);
  await fill(page,{ccOilCopra:3,ccOilQty:1.8,ccOilPoonac:1.1,ccOilCost:20.50,ccOilPaidDrawer:20.50});
  await page.getByRole('button',{name:'Save Oil Registry',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_oil')).length).toBe(1);
  let stock=await page.evaluate(()=>CoconutMgr.calcStock());
  expect(stock.rawLargeStock).toBe(50);expect(stock.peeledStock).toBe(30);expect(stock.husksStock).toBe(50);
  expect(stock.copraStock).toBe(2);expect(stock.oilStock).toBe(1.8);expect(stock.poonacStock).toBe(1.1);
  const oilSale=await sale(page,{type:'oil',qty:.8,price:800,transport:12.25,transportPaid:12.25});
  expect(oilSale.total).toBe(640);expect(oilSale.recDrawer).toBe(640);
  const poonacSale=await sale(page,{type:'poonac',qty:.1,price:120,method:'online'});
  expect(poonacSale.total).toBe(12);expect(poonacSale.recDrawer).toBe(0);
  await sale(page,{type:'copra',qty:.5,price:250,method:'card'});
  await sale(page,{type:'husks',qty:5,price:3,method:'cash'});
  stock=await page.evaluate(()=>CoconutMgr.calcStock());
  expect(stock.oilStock).toBeCloseTo(1);expect(stock.poonacStock).toBeCloseTo(1);expect(stock.copraStock).toBe(1.5);expect(stock.husksStock).toBe(45);
  const docs=await page.evaluate(({buyId,saleId})=>({purchase:CoconutMgr.buildPurchasePrintDoc(S.coconut_purchases.find(row=>row.id===buyId)),sale:CoconutMgr.buildSalePrintDoc(S.coconut_sales.find(row=>row.id===saleId))}),{buyId:buy.id,saleId:oilSale.id});
  expect(docs.purchase.text).toContain('10025.75');expect(docs.sale.text).toContain('640.00');expect(docs.sale.html).toContain('Coconut Oil');
  await page.locator('#ccTab_payroll').click();
  await page.locator('#ccPayWorkerSelect').selectOption(workerRow.id);
  await fill(page,{ccPayAmount:50.50,ccPayPaidDrawer:25.25});
  await page.getByRole('button',{name:'Save Payment',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_worker_payments')).length).toBe(1);
  await expect(page.locator('#ccWorkersLedger')).toContainText('59.25');
  await page.locator('#ccTab_summary').click();
  await expect(page.locator('#ccPLReportResult')).toContainText('Revenue less recorded costs');
  await expect(page.locator('#ccPLReportResult')).toContainText('Includes purchases held in stock.');
  await expect(page.locator('#ccPLReportResult')).toContainText('-9442.00');
  await expect(page.locator('#ccPLReportResult')).not.toContainText('Net Profit');
  await page.evaluate(()=>CoconutMgr.saveOpeningFloat(20000));
  const expected=20000+640+15-10025.75-40.25-10.25-20.50-12.25-25.25;
  expect((await page.evaluate(()=>CoconutMgr._drawerTotals(localBusinessDate()))).expectedCash).toBe(expected);
  await fill(page,{ccActualCash:expected,ccDayEndNote:'Balanced test close'});
  await page.getByRole('button',{name:'Save Coconut Day End',exact:false}).click();
  await expect.poll(async()=>(await records(page,'day_ends')).length).toBe(1);
  const close=(await records(page,'day_ends'))[0];expect(close.diff).toBe(0);expect(close.expectedCash).toBe(expected);
  await page.evaluate(()=>Sync.flush());
  expect(Object.keys(app.state.coconut_sales)).toHaveLength(4);
  expect(app.state.day_ends[close.id].diff).toBe(0);
});

test('coconut dependencies block destructive deletion and invalid counts, prices or payments write no records',async({page})=>{
  const buy=await purchase(page,{count:10,method:'cash'});await worker(page);
  await page.locator('#ccTab_processing').click();
  await fill(page,{ccHuskLargeCount:11,ccHuskRate:3,ccHuskPaidDrawer:0});
  expect(await page.evaluate(()=>CoconutMgr.saveHusking())).toBe(false);
  expect(await records(page,'coconut_husking')).toHaveLength(0);
  await fill(page,{ccHuskLargeCount:1.5});
  expect(await page.evaluate(()=>CoconutMgr.saveHusking())).toBe(false);
  const husking=await husk(page,{count:5,paid:3.25});
  expect(await page.evaluate(id=>CoconutMgr.deletePurchase(id),buy.id)).toBe(false);
  expect(await records(page,'coconut_purchases')).toHaveLength(1);
  await fill(page,{ccCopraNuts:6,ccCopraKg:2});
  expect(await page.evaluate(()=>CoconutMgr.saveCopra())).toBe(false);
  await fill(page,{ccCopraNuts:3,ccCopraKg:0});
  expect(await page.evaluate(()=>CoconutMgr.saveCopra())).toBe(false);
  await fill(page,{ccCopraNuts:3,ccCopraKg:.75,ccCopraCost:10,ccCopraPaidDrawer:11});
  expect(await page.evaluate(()=>CoconutMgr.saveCopra())).toBe(false);
  expect(await records(page,'coconut_copra')).toHaveLength(0);
  await fill(page,{ccCopraPaidDrawer:10});await page.evaluate(()=>CoconutMgr.saveCopra());
  const copraRow=(await records(page,'coconut_copra'))[0];
  expect(await page.evaluate(id=>CoconutMgr.deleteHusking(id),husking.id)).toBe(false);
  await page.evaluate(id=>CoconutMgr.deleteCopra(id),copraRow.id);
  expect(await records(page,'coconut_copra')).toHaveLength(0);
  expect((await records(page,'cash_movements')).some(row=>row.refId===copraRow.id)).toBe(false);
  await page.evaluate(id=>CoconutMgr.deleteHusking(id),husking.id);
  await page.evaluate(id=>CoconutMgr.deletePurchase(id),buy.id);
  expect(await records(page,'cash_movements')).toHaveLength(0);
  expect((await page.evaluate(()=>CoconutMgr.calcStock())).rawLargeStock).toBe(0);
});

test('legacy copra batches require measured yield and old invoices remain printable',async({page})=>{
  await page.evaluate(async()=>{
    await DB.batch([{type:'set',path:'coconut_copra/legacy',data:{date:localBusinessDate(),nutsUsed:10,dryingCost:5}},{type:'set',path:'coconut_sales/legacy_sale',data:{date:localBusinessDate(),type:'husked',qty:4,price:100,total:400,payMethod:'cash',recDrawer:400}}]);
    await loadAll();CoconutMgr.switchTab('processing');
  });
  let stock=await page.evaluate(()=>CoconutMgr.calcStock());expect(stock.copraStockKnown).toBe(false);
  await fill(page,{ccOilCopra:1,ccOilQty:.5,ccOilPoonac:.3});
  expect(await page.evaluate(()=>CoconutMgr.saveOil())).toBe(false);expect(await records(page,'coconut_oil')).toHaveLength(0);
  await page.evaluate(()=>CoconutMgr.recordCopraYield('legacy'));
  expect((await rows(page,'coconut_copra/legacy')).copraKg).toBe(2.5);
  await page.evaluate(()=>CoconutMgr.saveOil());expect(await records(page,'coconut_oil')).toHaveLength(1);
  stock=await page.evaluate(()=>CoconutMgr.calcStock());expect(stock.copraStockKnown).toBe(true);expect(stock.copraStock).toBe(1.5);
  const invoice=await page.evaluate(()=>CoconutMgr.buildSalePrintDoc(S.coconut_sales.find(row=>row.id==='legacy_sale')));
  expect(invoice.text).toContain('4 x Rs. 100.00');expect(invoice.text).toContain('400.00');
});

test('offline worker payment cannot exceed earned balance and paid work cannot be deleted',async({page,context})=>{
  await purchase(page,{count:10});await worker(page);
  const work=await husk(page,{count:5,rate:3,paid:3.25});
  await context.setOffline(true);
  await page.locator('#ccTab_payroll').click();
  await fill(page,{ccPayAmount:12,ccPayPaidDrawer:0});
  expect(await page.evaluate(()=>CoconutMgr.saveWorkerPayment())).toBe(false);
  expect(await records(page,'coconut_worker_payments')).toHaveLength(0);
  await fill(page,{ccPayAmount:5,ccPayPaidDrawer:5});
  await page.getByRole('button',{name:'Save Payment',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_worker_payments')).length).toBe(1);
  const payment=(await records(page,'coconut_worker_payments'))[0];
  expect(await page.evaluate(()=>CoconutMgr._workerOutstanding(S.coconut_workers[0].id))).toBe(6.75);
  expect(await page.evaluate(id=>CoconutMgr.deleteHusking(id),work.id)).toBe(false);
  expect(await records(page,'coconut_husking')).toHaveLength(1);
  await page.evaluate(id=>CoconutMgr.deleteWorkerPayment(id),payment.id);
  await page.evaluate(id=>CoconutMgr.deleteHusking(id),work.id);
  expect(await records(page,'coconut_husking')).toHaveLength(0);
});

test('sorting, sales and mixed copra runs consume the recorded stock groups', async ({page,app}) => {
  await purchase(page);
  await page.locator('#ccTab_sale').click();
  await fill(page,{ccSaleBuyer:'Raw buyer',ccSaleLargeCount:20,ccSaleLargePrice:120});
  await page.getByRole('button',{name:'Save Sale',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_sales')).length).toBe(1);

  await worker(page);
  await husk(page);
  await fill(page,{ccGradeLarge:20,ccGradeSmall:10,ccGradeDrying:15});
  await page.getByRole('button',{name:'Save Sorting'}).click();
  await expect(page.locator('#ccGradingList')).toContainText('15 for drying');
  await expect(page.locator('#ccGradeAvailable')).toContainText('5');

  await page.locator('#ccTab_sale').click();
  await page.locator('#ccSaleType').selectOption('husked');
  await page.locator('#ccSaleGrade').selectOption('large');
  await expect(page.locator('#ccSaleGradeAvailable')).toContainText('20 nuts');
  await fill(page,{ccSaleBuyer:'Large nuts buyer',ccSaleCount:6,ccSalePrice:150});
  await page.getByRole('button',{name:'Save Sale',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_sales')).length).toBe(2);
  const gradedSale = (await records(page,'coconut_sales')).find(entry=>entry.peeledGrade==='large');
  expect(gradedSale).toMatchObject({qty:6,total:900});
  expect(await page.evaluate(row=>CoconutMgr.buildSalePrintDoc(row).text,gradedSale)).toContain('Large peeled coconuts');
  await expect(page.locator('#ccSaleGradeAvailable')).toContainText('14 nuts');

  await page.locator('#ccTab_processing').click();
  await page.locator('#ccSection_processing summary').filter({hasText:'Use sorted coconuts'}).click();
  await fill(page,{ccCopraNuts:2,ccCopraLarge:1,ccCopraSmall:2,ccCopraDrying:10,ccCopraKg:4});
  await page.getByRole('button',{name:'Save Copra Registry',exact:false}).click();
  await expect.poll(async()=>(await records(page,'coconut_copra')).length).toBe(1);
  const production = (await records(page,'coconut_copra'))[0];
  expect(production).toMatchObject({nutsUsed:15,copraKg:4,inputNuts:{unsorted:2,large:1,small:2,drying:10}});

  const graded = (await records(page,'coconut_gradings'))[0];
  expect(await page.evaluate(id=>CoconutMgr.deleteGrading(id),graded.id)).toBe(false);
  const stock = await page.evaluate(()=>CoconutMgr.calcStock());
  expect(stock).toMatchObject({rawLargeStock:30,peeledStock:3,peeledLargeStock:13,peeledSmallStock:8,peeledDryingStock:5,copraStock:4});
  await expect.poll(()=>Object.values(app.state.coconut_gradings).length).toBe(1);
  expect(app.state.coconut_copra[production.id].copraKg).toBe(4);
});
