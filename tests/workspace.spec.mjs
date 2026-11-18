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
const rows=(page,path)=>page.evaluate(path=>DB.get(path),path);
async function buy(page,id,quantity){
  await page.locator(`.item-card[onclick="POS.addFlow('${id}')"]`).click();
  if(id!=='eggs'){
    await page.locator('#wt2').click();
    await page.locator('#wQty').fill(String(quantity));
    await page.locator('#wBody2 button').click();
  }
}

test('weighted and repeated products commit one stock allocation, receipt and durable bill',async({page,app})=>{
  await buy(page,'chicken',2);await buy(page,'chicken',2);
  await expect(page.locator('#cartTotal')).toContainText('4800.00');
  await page.locator('#checkoutBtn').click();
  await expect.poll(async()=>Object.keys(await rows(page,'sales')).length).toBe(1);
  const sale=Object.values(await rows(page,'sales'))[0];
  expect(sale.total).toBe(4800);expect(sale.profit).toBe(1200);
  expect((await rows(page,'items/chicken')).stockBatches[0].quantity).toBe(11);
  expect(sale.receiptText).toContain('Fresh whole chicken');
  expect(await page.evaluate(()=>S.cart.length)).toBe(0);
  await page.keyboard.press('Escape');
  const result=await page.evaluate(async()=>{S.cart=[{itemId:'chicken',name:'Fresh whole chicken',qty:20,unit:'kg',price:24000,unitPrice:1200,discount:0,saleMode:'retail'}];Cart.render();return Checkout.run(true);});
  expect(result).toBe(false);expect(Object.keys(await rows(page,'sales'))).toHaveLength(1);
  await page.evaluate(()=>Sync.flush());
  expect(app.state.items.chicken.stockBatches[0].quantity).toBe(11);
});

test('custom products are captured and discounted partial returns reverse actual revenue and cost',async({page})=>{
  await page.locator('#posCustomBtn').click();
  await page.locator('#customItemName').fill('Packaging service');await page.locator('#customItemPrice').fill('100');
  await page.locator('#optContent').getByRole('button',{name:'Add',exact:true}).click();
  await page.locator('#checkoutBtn').click();
  let sales=Object.values(await rows(page,'sales'));
  expect(sales[0].items[0].name).toBe('Packaging service');expect(sales[0].total).toBe(100);
  await expect(page.locator('#receiptModal')).toHaveClass(/open/);await page.keyboard.press('Escape');
  await buy(page,'eggs',1);await buy(page,'eggs',1);
  await page.evaluate(()=>{S.cartDisc=10;S.cartDiscType='fixed';Cart.render();});
  await page.locator('#checkoutBtn').click();await expect(page.locator('#receiptModal')).toHaveClass(/open/);await page.keyboard.press('Escape');
  const sale=Object.values(await rows(page,'sales')).find(sale=>sale.items[0].itemId==='eggs');
  expect(sale.total).toBe(80);expect(sale.profit).toBe(10);
  for(let count=0;count<2;count++){
    await page.evaluate(id=>SaleDetail.openReturn(id),sale.id||Object.entries(await rows(page,'sales')).find(([,value])=>value.billId===sale.billId)[0]);
    await page.locator('.ret-qty').fill('1');
    await page.locator('#discBody').getByRole('button',{name:'Refund',exact:true}).click();
    await expect.poll(async()=>Object.values(await rows(page,'sales')).filter(row=>row.status==='return').length).toBe(count+1);
  }
  sales=Object.values(await rows(page,'sales'));
  expect(sales.filter(row=>row.status==='return').map(row=>row.total)).toEqual([-40,-40]);
  expect(sales.reduce((sum,row)=>sum+row.profit,0)).toBe(100);
  expect((await rows(page,'items/eggs')).stockBatches[0].quantity+((await rows(page,'items/eggs')).stockBatches.slice(1).reduce((sum,batch)=>sum+batch.quantity,0))).toBe(60);
  expect(await page.evaluate(()=>SaleAccounting.posDay(localBusinessDate()).posCashIn)).toBe(100);
});

test('exchange credit is used as payment while revenue, cost and drawer cash stay consistent',async({page})=>{
  await buy(page,'eggs',1);await page.locator('#checkoutBtn').click();await expect(page.locator('#receiptModal')).toHaveClass(/open/);await page.keyboard.press('Escape');
  const sourceId=Object.keys(await rows(page,'sales'))[0];
  await page.evaluate(id=>SaleDetail.openReturn(id),sourceId);
  await page.locator('#discBody').getByRole('button',{name:'Exchange credit',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>S.cart.some(line=>line.isExchangeCredit))).toBe(true);
  await buy(page,'chicken',.1);
  await expect(page.locator('#cartTotal')).toContainText('75.00');
  await page.locator('#checkoutBtn').click();
  const sales=Object.values(await rows(page,'sales'));
  const replacement=sales.find(sale=>sale.exchangeCreditAmount>0);
  expect(replacement.total).toBe(120);expect(replacement.cashReceived).toBe(75);expect(replacement.profit).toBe(30);
  expect(replacement.receiptText).toContain('Exchange Credit');
  expect(sales.find(sale=>sale.payMethod==='exchange').exchangeCreditRemaining).toBe(0);
  expect(await page.evaluate(()=>SaleAccounting.posDay(localBusinessDate()).posCashIn)).toBe(120);
  expect(sales.reduce((sum,sale)=>sum+sale.profit,0)).toBe(30);
});

test('customer credit accepts an initial payment and partial collections without clearing the remainder',async({page})=>{
  await page.evaluate(async()=>{const id=await DB.push('loan_customers',{name:'Credit Customer',phone:'0771234567'});await loadAll();POS.setMode('loan');});
  await buy(page,'eggs',1);await buy(page,'eggs',1);await buy(page,'eggs',1);
  await page.locator('#loanCheckoutBtn').click();
  const customerId=Object.keys(await rows(page,'loan_customers'))[0];
  await page.locator('#lnCust').selectOption(customerId);
  await page.locator('#lnInit').fill('35');
  await page.locator('#lnInstCount').fill('2');
  await page.locator('#loanNewBody').getByRole('button',{name:/Create Loan/}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'loans')).length).toBe(1);
  const id=Object.keys(await rows(page,'loans'))[0];
  await page.evaluate(async id=>{await loadAll();LoanMgr._loans=S.loans;LoanMgr.openPayment(id);},id);
  await page.locator('#lpAmt').fill('40');
  await page.locator('#loanPayBody').getByRole('button',{name:/Record Payment/}).click();
  const loan=await rows(page,'loans/'+id);
  expect(loan.totalAmount).toBe(135);expect(loan.paidAmount).toBe(75);
  expect(await page.evaluate(id=>LoanMgr._remaining(LoanMgr._loans.find(loan=>loan.id===id)),id)).toBe(60);
  const rejected=await page.evaluate(id=>LoanMgr._applyPayment(id,61,'Invalid excess',localBusinessDate()),id);
  expect(rejected).toBe(false);expect((await rows(page,'loans/'+id)).paidAmount).toBe(75);
});

test('coconut purchases, processing, payroll and day-end maintain dated stock and exact drawer cents',async({page})=>{
  await page.evaluate(()=>Nav.go('coconut'));
  await page.locator('#ccTab_buy').click();
  await page.locator('#ccBuyEstate').fill('Sample Estate');
  await page.locator('#ccBuyLargeCount').fill('100');await page.locator('#ccBuyLargePrice').fill('100');
  await page.locator('#ccBuySmallCount').fill('50');await page.locator('#ccBuySmallPrice').fill('70');
  await page.locator('#ccBuyPayMethod').selectOption('bank');
  await page.getByRole('button',{name:'Save Purchase',exact:false}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'coconut_purchases')).length).toBe(1);
  expect(Object.keys(await rows(page,'cash_movements'))).toHaveLength(0);
  await page.locator('#ccTab_payroll').click();await page.locator('#ccWorkerName').fill('Sample Worker');
  await page.getByRole('button',{name:'Add Worker',exact:false}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'coconut_workers')).length).toBe(1);
  await page.locator('#ccTab_processing').click();
  await page.locator('#ccHuskLargeCount').fill('3');await page.locator('#ccHuskRate').fill('3.25');
  await expect(page.locator('#ccHuskPaidDrawer')).toHaveValue('9.75');
  await page.getByRole('button',{name:'Save Husking',exact:false}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'coconut_husking')).length).toBe(1);
  expect((await page.evaluate(()=>CoconutMgr.calcStock())).rawLargeStock).toBe(97);
  await page.locator('#ccCopraNuts').fill('2');await page.locator('#ccCopraKg').fill('.4');
  await page.getByRole('button',{name:'Save Copra Registry',exact:false}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'coconut_copra')).length).toBe(1);
  expect((await page.evaluate(()=>CoconutMgr.calcStock())).copraStock).toBe(.4);
  await page.locator('#ccTab_summary').click();
  await page.locator('#ccActualCash').fill('0');
  await page.getByRole('button',{name:'Save Coconut Day End',exact:false}).click();
  await expect.poll(async()=>Object.keys(await rows(page,'day_ends')).length).toBe(1);
  const saved=Object.values(await rows(page,'day_ends'))[0];
  expect(saved.expectedCash).toBe(-9.75);expect(saved.diff).toBe(9.75);
  expect(await page.evaluate(()=>/[\u0d80-\u0dff]/.test(document.body.innerText))).toBe(false);
});