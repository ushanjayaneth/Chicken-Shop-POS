import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase,LocalStore} from '../src/lib/local/db';
import {createLocalApi,initializeLocalWorkspace,bootstrap} from '../src/lib/local/core';
import {buildBackupPayload,validateDeviceBackupPayload} from '../src/lib/local/backup';
import {encryptDeviceBackup,decryptDeviceBackup} from '../src/lib/local/backup-crypto';
import {lineAmount,validSaleQuantity} from '../shared/retail';
import {productCost,profitability,businessDate} from '../shared/costing';
import type {InventoryItem,MenuItem,Order,Shift,Snapshot,User} from '../shared/types';
import {monitorCommand} from '../server/monitor/engine';
import {applyOfflineCommit} from '../server/monitor/offline';
import {MemoryMonitorStore,recordKey,type Projection} from '../server/monitor/store';
import {createMonitorHandler} from '../server/monitor/handler';
import type {OfflineCloudCommit} from '../shared/offline-cloud';

async function fixture(demo=true){const db=new LocalDatabase(`retail-test-${crypto.randomUUID()}`);const setup=await initializeLocalWorkspace({businessName:'Retail Test',ownerName:'Shop Owner',pin:'98765432',demo},db);const api=createLocalApi(db);return {db,store:new LocalStore(db),api,user:setup.user};}
const cid=()=>crypto.randomUUID();

test('retail setup has a grocery catalog and no restaurant data; live setup has no fake business transactions',async()=>{
 for(const demo of [true,false]){const f=await fixture(demo);try{const data=await f.api<Snapshot>('/bootstrap');assert.equal(data.tables.length,0);assert.equal(data.recipes.length,0);assert.equal(data.production.length,0);assert.equal(data.orders.length,0);assert.equal(data.menu.length,demo?18:0);assert.ok(data.menu.every(row=>row.saleUnit&&row.barcode&&row.stockMode==='prepared'));assert.ok(data.inventory.every(row=>row.category==='resale'));assert.equal(data.settings.businessName,'Retail Test');}finally{await f.db.delete();}}
});

test('weighted checkout holds three decimals, rounds each bill line and captures cost while selling stock down to zero',async()=>{
 const f=await fixture();try{
  await f.api('/menu/m1',{commandId:cid(),price:24999,cost:17333,saleUnit:'kg'},'PATCH');
  await f.api('/inventory/b1-prepared-m1',{commandId:cid(),branchId:'b1',quantity:1,expectedQuantity:86,unitCost:17333},'PATCH');
  const held=await f.api<any>('/held-bills',{commandId:cid(),branchId:'b1',type:'takeaway',label:'Weighed customer',lines:[{menuItemId:'m1',quantity:.125}]});
  const created=await f.api<{order:Order}>('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',heldBillId:held.heldBill.id,expectedHeldUpdatedAt:held.heldBill.updatedAt,lines:held.heldBill.lines});
  assert.equal(created.order.total,3125);assert.equal(created.order.lines[0].saleUnit,'kg');assert.equal(created.order.lines[0].unitCost,17333);assert.equal(lineAmount(17333,.125),2167);
  assert.equal((await f.store.get<InventoryItem>('inventory','b1-prepared-m1'))!.quantity,.875);
  await f.api(`/orders/${created.order.id}/payments`,{commandId:cid(),expectedVersion:created.order.version,method:'cash',amount:3125,received:4000});
  const second=await f.api<{order:Order}>('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',lines:[{menuItemId:'m1',quantity:.875}]});
  assert.equal(second.order.total,21874);assert.equal((await f.store.get<InventoryItem>('inventory','b1-prepared-m1'))!.quantity,0);
  assert.equal((await f.api<Snapshot>('/bootstrap')).menu.find(row=>row.id==='m1')!.available,false);
 }finally{await f.db.delete();}
});

test('counted goods reject fractions and weighed goods reject excess precision and overselling without partial writes',async()=>{
 const f=await fixture();try{const before=(await f.api<Snapshot>('/bootstrap')).inventory;
  for(const [id,quantity]of [['m4',.5],['m1',.0001],['m1',87]] as const){await assert.rejects(f.api('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',lines:[{menuItemId:id,quantity}]}));}
  assert.equal((await f.store.list('order')).length,0);assert.deepEqual((await f.api<Snapshot>('/bootstrap')).inventory,before);
  assert.equal(validSaleQuantity(.125,'kg'),true);assert.equal(validSaleQuantity(.125,'pcs'),false);assert.equal(validSaleQuantity(.0001,'kg'),false);
 }finally{await f.db.delete();}
});

test('retail and wholesale prices share stock, preserve held price mode and capture the selected price on confirmation',async()=>{
 const f=await fixture();try{
  await f.api('/menu/m1',{commandId:cid(),price:24999,wholesalePrice:23001},'PATCH');
  const held=(await f.api<any>('/held-bills',{commandId:cid(),branchId:'b1',type:'takeaway',priceMode:'wholesale',label:'Trade customer',lines:[{menuItemId:'m1',quantity:.125}]})).heldBill;
  assert.equal(held.priceMode,'wholesale');
  const order=(await f.api<{order:Order}>('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',priceMode:held.priceMode,heldBillId:held.id,expectedHeldUpdatedAt:held.updatedAt,lines:held.lines})).order;
  assert.equal(order.priceMode,'wholesale');assert.equal(order.total,2875);assert.equal(order.lines[0].unitPrice,23001);
  await f.api('/menu/m1',{commandId:cid(),wholesalePrice:21000},'PATCH');assert.equal((await f.store.get<Order>('order',order.id))!.total,2875);
  const retail=(await f.api<{order:Order}>('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',priceMode:'retail',lines:[{menuItemId:'m1',quantity:.125}]})).order;assert.equal(retail.total,3125);
  await f.api('/menu/m4',{commandId:cid(),wholesalePrice:0},'PATCH');const fallback=(await f.api<{order:Order}>('/orders',{commandId:cid(),branchId:'b1',type:'takeaway',priceMode:'wholesale',lines:[{menuItemId:'m4',quantity:1}]})).order;assert.equal(fallback.total,24000);
  assert.equal((await f.store.get<InventoryItem>('inventory','b1-prepared-m1'))!.quantity,85.75);
 }finally{await f.db.delete();}
});

test('supplier installments reduce only the paid amount, deduct cash once, export cashflow and survive encrypted backup',async()=>{
 const f=await fixture();try{
  const shift=(await f.store.list<Shift>('shift','b1'))[0];await f.store.put('shift',{...shift,openingFloat:100000,expectedCash:100000});
  const supplier=(await f.api<any>('/suppliers',{commandId:cid(),name:'Wholesale Supplier',phone:'0771234567'})).supplier;
  await f.api('/purchases',{commandId:cid(),branchId:'b1',supplierId:supplier.id,invoiceNumber:'INV-RETAIL-1',lines:[{itemId:'b1-prepared-m4',quantity:5,unitCost:20000}]});
  const body={commandId:cid(),branchId:'b1',amount:20000,method:'cash',reference:'PART-1'};
  const first=await f.api(`/suppliers/${supplier.id}/payments`,body);assert.deepEqual(await f.api(`/suppliers/${supplier.id}/payments`,body),first);
  await f.api(`/suppliers/${supplier.id}/payments`,{commandId:cid(),branchId:'b1',amount:10000,method:'qr'});
  const data=await f.api<Snapshot>('/bootstrap');assert.equal(data.suppliers.find(row=>row.id===supplier.id)!.balance,70000);assert.equal(data.supplierPayments!.length,2);assert.equal(data.shifts[0].expectedCash,80000);
  await assert.rejects(f.api(`/suppliers/${supplier.id}/payments`,{commandId:cid(),branchId:'b1',amount:70001,method:'card'}));
  const day=businessDate(new Date().toISOString());const report=await f.api<any>(`/reports/income-expenses?branchId=b1&from=${day}&to=${day}&format=json`);assert.equal(report.expense,30000);assert.equal(profitability(data,day,day).costOfSales,0);
  const payload=await buildBackupPayload(f.db);const encrypted=await encryptDeviceBackup(payload,'retail-backup-password');const restored=validateDeviceBackupPayload(await decryptDeviceBackup(encrypted,'retail-backup-password'));assert.equal(restored.tables.records.filter(row=>row.kind==='supplierPayment').length,2);
 }finally{await f.db.delete();}
});

test('best-before edits preserve current stock and old prices cannot silently change an existing stock unit',async()=>{
 const f=await fixture();try{const stock=await f.store.get<InventoryItem>('inventory','b1-prepared-m1');
  await f.api(`/inventory/${stock!.id}`,{commandId:cid(),branchId:'b1',expiryDate:'2030-12-31'},'PATCH');
  await f.api('/menu/m1',{commandId:cid(),price:30000},'PATCH');const after=await f.store.get<InventoryItem>('inventory',stock!.id);assert.equal(after!.quantity,86);assert.equal(after!.expiryDate,'2030-12-31');
  await assert.rejects(f.api('/menu/m1',{commandId:cid(),saleUnit:'pcs'},'PATCH'));
 }finally{await f.db.delete();}
});

test('weighed offline bills and supplier installments replay into the shared cloud once and appear on a second device',async()=>{
 const f=await fixture();try{
  const stamp=new Date().toISOString(),sourceId='retail-shared-test';
  const rows=(await f.db.records.toArray()).filter(row=>row.kind!=='staff').map(row=>({kind:row.kind as any,id:row.id,branchId:row.branchId,value:row.value as Record<string,unknown>}));
  const initial:Projection={revision:1,source:{sourceId,workspaceId:'retail-shop',businessName:'Retail Test',deviceName:'Shared',epoch:'retail',sequence:0,ready:true,shared:true,revoked:false,updatedAt:stamp,lastSeenAt:stamp,dataVersion:1},records:Object.fromEntries(rows.map(row=>[recordKey(row.kind,row.id),row])),metadata:{settings:await f.store.meta('settings'),activeBranchId:'b1',deviceId:'cloud'},commands:{}};
  const store=new MemoryMonitorStore();await store.replace(sourceId,null,initial);const handler=createMonitorHandler({store,env:{CLOUD_POS_PIN:'98765432',CLOUD_SESSION_SECRET:'r'.repeat(64)}});
  const login=await handler(new Request('https://retail.test/api/cloud?action=pos-login',{method:'POST',headers:{Origin:'https://retail.test','Content-Type':'application/json'},body:JSON.stringify({pin:'98765432'})}));assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const device=structuredClone(initial);device.metadata.deviceId='retail-offline-device';
  async function queue(path:string,body:Record<string,unknown>){const before=structuredClone(device),transactionId=cid();await monitorCommand(device,path,'POST',{...body,commandId:transactionId},new URLSearchParams());const changes=[...new Set([...Object.keys(device.records),...Object.keys(before.records)])].filter(key=>JSON.stringify(device.records[key])!==JSON.stringify(before.records[key])).map(key=>{const row=device.records[key]??before.records[key];return {kind:row.kind,id:row.id,branchId:row.branchId,before:before.records[key]?.value??null,after:device.records[key]?.value??null};});const packet:OfflineCloudCommit={sourceId,deviceId:'retail-offline-device',transactionId,createdAt:new Date().toISOString(),path,method:'POST',offline:true,changes};const call=()=>handler(new Request('https://retail.test/api/cloud?action=offline-commit',{method:'POST',headers:{Origin:'https://retail.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(packet)}));const first=await call();assert.equal(first.status,200,await first.clone().text());assert.equal((await call()).status,200);}
  await queue('/orders',{branchId:'b1',type:'takeaway',lines:[{menuItemId:'m1',quantity:.125}]});
  await queue('/purchases',{branchId:'b1',supplierId:'supplier-demo',invoiceNumber:'CLOUD-1',lines:[{itemId:'b1-prepared-m4',quantity:1,unitCost:10000}]});
  await queue('/suppliers/supplier-demo/payments',{branchId:'b1',amount:2500,method:'qr'});
  const cloud=(await store.get(sourceId))!;assert.equal(Object.values(cloud.records).filter(row=>row.kind==='order').length,1);assert.equal(cloud.records[recordKey('inventory','b1-prepared-m1')].value.quantity,85.875);assert.equal(cloud.records[recordKey('supplier','supplier-demo')].value.balance,7500);assert.equal(Object.values(cloud.records).filter(row=>row.kind==='supplierPayment').length,1);
  const bootstrapResponse=await handler(new Request(`https://retail.test/api/cloud?action=bootstrap&sourceId=${sourceId}&branchId=b1`,{headers:{Cookie:cookie}}));assert.equal(bootstrapResponse.status,200);const secondDevice=await bootstrapResponse.json();assert.equal(secondDevice.suppliers.find((row:any)=>row.id==='supplier-demo').balance,7500);
 }finally{await f.db.delete();}
});
