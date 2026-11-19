import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase,LocalStore} from '../src/lib/local/db';
import {createLocalApi,initializeLocalWorkspace} from '../src/lib/local/core';
import {buildBackupPayload} from '../src/lib/local/backup';
import {createApp} from '../server/app';
import {monitorCommand,monitorBootstrap} from '../server/monitor/engine';
import {MemoryMonitorStore,recordKey,type Projection} from '../server/monitor/store';
import {createMonitorHandler} from '../server/monitor/handler';
import type {OfflineCloudCommit} from '../shared/offline-cloud';
import type {Snapshot,Shift} from '../shared/types';
import {staffBalance,type Employee} from '../shared/staff';
import {businessDate,profitability} from '../shared/costing';

const cid=()=>crypto.randomUUID(),day=()=>businessDate(new Date().toISOString());
type Api=(path:string,body?:Record<string,unknown>,method?:string)=>Promise<any>;
async function fixture(mode:'device'|'hub'|'cloud'){
 if(mode==='hub'){
  const app=await createApp({databasePath:':memory:',seed:true});const login=await app.inject({method:'POST',url:'/api/login',payload:{pin:'1234'}});assert.equal(login.statusCode,200,login.body);const cookie=login.cookies.map(row=>`${row.name}=${row.value}`).join('; ');
  const store=(app as any).store;const shift=store.list('shift','b1')[0];store.put('shift',{...shift,openingFloat:10000000,expectedCash:10000000});
  const api:Api=async(path,body,method)=>{const response=await app.inject({method:(method??(body?'POST':'GET')) as any,url:'/api'+path,headers:{cookie},payload:body});const result=response.json();if(response.statusCode>=400)throw Object.assign(new Error(result.error),{code:result.code});return result;};return {api,close:()=>app.close()};
 }
 const db=new LocalDatabase('staff-test-'+cid());await initializeLocalWorkspace({businessName:'Staff Test',ownerName:'Owner',pin:'98765432',demo:true},db);const store=new LocalStore(db),shift=(await store.list<Shift>('shift','b1'))[0];await store.put('shift',{...shift,openingFloat:10000000,expectedCash:10000000});
 if(mode==='device')return {api:createLocalApi(db) as Api,close:()=>db.delete(),db};
 const timestamp=new Date().toISOString(),sourceId='staff-shop';const rows=(await db.records.toArray()).map(row=>({kind:row.kind as any,id:row.id,branchId:row.branchId,value:row.value as Record<string,unknown>}));
 const initial:Projection={revision:1,source:{sourceId,workspaceId:'staff',businessName:'Staff Test',deviceName:'Shared',epoch:'staff',sequence:0,ready:true,shared:true,revoked:false,updatedAt:timestamp,lastSeenAt:timestamp,dataVersion:1},records:Object.fromEntries(rows.map(row=>[recordKey(row.kind,row.id),row])),metadata:{settings:await store.meta('settings'),activeBranchId:'b1',deviceId:'staff-cloud'},commands:{}};
 const cloud=new MemoryMonitorStore();await cloud.replace(sourceId,null,initial);const handler=createMonitorHandler({store:cloud,env:{CLOUD_POS_PIN:'98765432',CLOUD_SESSION_SECRET:'e'.repeat(64)}});const login=await handler(new Request('https://staff.test/api/cloud?action=pos-login',{method:'POST',headers:{Origin:'https://staff.test','Content-Type':'application/json'},body:JSON.stringify({pin:'98765432'})}));assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];const pending=new Map<string,{packet:OfflineCloudCommit;result:any}>();
 const api:Api=async(path,body,method='POST')=>{
  if(path==='/bootstrap')return monitorBootstrap((await cloud.get(sourceId))!,new URLSearchParams());
  if(path.startsWith('/reports/')){const url=new URL(path,'https://staff.test');return monitorCommand((await cloud.get(sourceId))!,url.pathname,'GET',{},url.searchParams);}
  const commandId=String(body!.commandId);let entry=pending.get(commandId);
  if(!entry){const before=(await cloud.get(sourceId))!,device=structuredClone(before);device.metadata.deviceId='staff-offline-device';const result=await monitorCommand(device,path,method,body!,new URLSearchParams());const changes=[...new Set([...Object.keys(device.records),...Object.keys(before.records)])].filter(key=>JSON.stringify(device.records[key])!==JSON.stringify(before.records[key])).map(key=>{const row=device.records[key]??before.records[key];return {kind:row.kind,id:row.id,branchId:row.branchId,before:before.records[key]?.value??null,after:device.records[key]?.value??null};});entry={packet:{sourceId,deviceId:'staff-offline-device',transactionId:commandId,createdAt:new Date().toISOString(),path,method,offline:true,changes},result};pending.set(commandId,entry);}
  const response=await handler(new Request('https://staff.test/api/cloud?action=offline-commit',{method:'POST',headers:{Origin:'https://staff.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(entry.packet)}));const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:result.code});return entry.result;
 };return {api,close:()=>db.delete()};
}

for(const mode of ['device','hub','cloud'] as const){
 test(`${mode}: attendance, staff loans, advances and salary recoveries preserve exact balances and payroll is paid once`,async()=>{
  const f=await fixture(mode);try{const employee=(await f.api('/hr/employees',{commandId:cid(),branchId:'b1',name:'Cashier Person',phone:'0771231234',position:'Cashier',monthlySalary:5000000})).employee as Employee;
   const checkIn=new Date(`${day()}T08:00:00+05:30`).toISOString(),checkOut=new Date(`${day()}T17:00:00+05:30`).toISOString();
   await f.api('/hr/attendance',{commandId:cid(),branchId:'b1',employeeId:employee.id,date:day(),status:'present',checkIn,checkOut});
   await f.api('/hr/transactions',{commandId:cid(),branchId:'b1',employeeId:employee.id,account:'advance',direction:'issued',amount:500000,method:'cash'});
   await f.api('/hr/transactions',{commandId:cid(),branchId:'b1',employeeId:employee.id,account:'loan',direction:'issued',amount:1000000,method:'cash'});
   await f.api('/hr/transactions',{commandId:cid(),branchId:'b1',employeeId:employee.id,account:'loan',direction:'repaid',amount:100000,method:'cash'});
   const payment={commandId:cid(),branchId:'b1',employeeId:employee.id,period:day().slice(0,7),baseSalary:5000000,advanceDeduction:500000,loanDeduction:200000,method:'cash'};
   const first=await f.api('/hr/payroll',payment);assert.deepEqual(await f.api('/hr/payroll',payment),first);await assert.rejects(f.api('/hr/payroll',{...payment,commandId:cid()}));
   const data=await f.api('/bootstrap') as Snapshot;assert.equal(data.payroll!.length,1);assert.equal(data.payroll![0].net,4300000);assert.equal(data.payroll![0].employeeName,'Cashier Person');assert.equal(data.shifts[0].expectedCash,4300000);assert.equal(staffBalance(data.staffTransactions!,employee.id,'advance'),0);assert.equal(staffBalance(data.staffTransactions!,employee.id,'loan'),700000);assert.equal(data.attendance![0].status,'present');assert.equal(data.expenses.filter(row=>row.paymentMethod==='payroll').length,1);
   assert.equal(profitability(data,day(),day()).operatingExpenses,5000000);
   const report=await f.api(`/reports/income-expenses?branchId=b1&from=${day()}&to=${day()}&format=json`);assert.equal(report.income,100000);assert.equal(report.expense,5800000);assert.equal(report.net,-5700000);
   if('db'in f){const backup=await buildBackupPayload(f.db!);assert.equal(backup.tables.records.filter(row=>row.kind==='payroll').length,1);}
  }finally{await f.close();}
 });
 test(`${mode}: excessive repayments, insufficient cash and invalid attendance leave employee balances untouched`,async()=>{
  const f=await fixture(mode);try{const employee=(await f.api('/hr/employees',{commandId:cid(),branchId:'b1',name:'Stock Person',monthlySalary:5000000})).employee;
   await assert.rejects(f.api('/hr/transactions',{commandId:cid(),branchId:'b1',employeeId:employee.id,account:'loan',direction:'repaid',amount:1,method:'cash'}));
   await assert.rejects(f.api('/hr/payroll',{commandId:cid(),branchId:'b1',employeeId:employee.id,period:day().slice(0,7),baseSalary:10000001,method:'cash'}));
   await assert.rejects(f.api('/hr/attendance',{commandId:cid(),branchId:'b1',employeeId:employee.id,date:day(),status:'absent',checkIn:new Date().toISOString()}));
   const data=await f.api('/bootstrap') as Snapshot;assert.equal(data.payroll!.length,0);assert.equal(data.staffTransactions!.length,0);assert.equal(data.attendance!.length,0);assert.equal(data.shifts[0].expectedCash,10000000);
  }finally{await f.close();}
 });
}
