import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

function fixture() {
  const mirror = new Map();
  let lock = Promise.resolve();
  const context = vm.createContext({
    indexedDB:new IDBFactory(), IDBKeyRange, structuredClone, crypto:globalThis.crypto, AbortSignal,
    console:{warn(){}}, setInterval, clearInterval,
    navigator:{onLine:false, locks:{request(_name, action){const pending=lock.then(action);lock=pending.catch(()=>{});return pending;}}},
    document:{getElementById(){return {dataset:{},className:'',title:'',setAttribute(){}};}}, window:{addEventListener(){}},
    localStorage:{getItem:key=>mirror.get(key)||null, setItem:(key,value)=>mirror.set(key,value), removeItem:key=>mirror.delete(key)},
    S:{settings:{currency:'Rs.',apiServerUrl:''}}, normalizeReceiptNote:value=>value||'', loadAll:async()=>{}, scheduleDataRefresh(){},
    getApiUrl:path=>'https://fixture.test/api/data/'+path, fetch:async()=>{throw new Error('No production requests allowed');}
  });
  vm.runInContext(readFileSync('data-core.js','utf8')+'\n'+readFileSync('backup.js','utf8')+'\nglobalThis.testAPI={IDB,DB,Sync,BackupStore,Drafts};',context);
  return {...context.testAPI, context, mirror};
}
const plain = value => JSON.parse(JSON.stringify(value));

test('a complete backup includes coconut records, customer collections and pending offline operations',async()=>{
  const f=fixture();
  await f.DB.batch([{type:'set',path:'items/chicken',data:{name:'Chicken',stockBatches:[{quantity:5}]}},{type:'set',path:'loans/one',data:{totalAmount:100,paidAmount:40}},{type:'set',path:'coconut_purchases/one',data:{largeQty:50,smallQty:25}}]);
  await f.IDB.cacheSet('__deviceDraft',{cart:[{id:'chicken',qty:1}],heldSales:[],savedAt:100});
  const backup=await f.BackupStore.snapshot();
  assert.equal(backup.format,'mr-chicken-house-backup');
  assert.equal(backup.pendingQueue.length,1);
  assert.equal(backup.cache.find(row=>row.path==='loans').data.one.paidAmount,40);
  assert.equal(backup.cache.find(row=>row.path==='coconut_purchases').data.one.largeQty,50);
  assert.equal(backup.cache.find(row=>row.path==='__deviceDraft').data.cart.length,1);
  f.IDB._db?.close();
});

test('restore replaces stale queue atomically and queues the resulting snapshot exactly once',async()=>{
  const f=fixture();
  await f.DB.set('sales/restored',{total:250});
  await f.DB.set('items/a',{stockBatches:[{quantity:8}]});
  await f.IDB.cacheSet('__deviceDraft',{cart:[],heldSales:[{id:'held'}],savedAt:1});
  const snapshot=await f.BackupStore.snapshot();
  await f.DB.set('sales/stale',{total:900});
  await f.DB.set('loans/stale',{totalAmount:999});
  await f.BackupStore.restore(snapshot);
  assert.deepEqual(plain(await f.DB.get('sales')),{restored:{total:250}});
  assert.deepEqual(plain(await f.DB.get('loans')),{});
  const queue=await f.IDB.queueGetAll();
  assert.equal(queue.length,1);
  assert.equal(queue[0].type,'batch');
  assert.equal(queue[0].data.sales.restored.total,250);
  assert.equal(queue[0].data.loans,null);
  assert.equal(queue[0].data.__deviceDraft,undefined);
  assert.equal(queue[0].data['sales/stale'],undefined);
  assert.equal(JSON.parse(f.mirror.get('chicken-pos-draft-v1')).heldSales[0].id,'held');
  f.IDB._db?.close();
});

test('both legacy backup formats retain canonical records, correct IDs and settings',async()=>{
  const f=fixture();
  let normalized=f.BackupStore.normalize({items:[{id:'a',name:'Chicken'}],sales:[{id:'bill',total:75}],categories:[],settings:{adminPin:'4567'}});
  assert.equal(normalized.updates.items.a.name,'Chicken');
  assert.equal(normalized.updates.items.a.id,undefined);
  assert.equal(normalized.updates.settings.main.adminPin,'4567');
  normalized=f.BackupStore.normalize({'items/a':{name:'Old stale'},items:{a:{name:'Canonical'}},'loans/one':{paidAmount:10},__settings:{adminPin:'5678'}});
  assert.equal(normalized.updates.items.a.name,'Canonical');
  assert.equal(normalized.updates.loans.one.paidAmount,10);
  assert.equal(normalized.updates.settings.main.adminPin,'5678');
  f.IDB._db?.close();
});

test('invalid backups preserve existing local data and pending payments',async()=>{
  const f=fixture();
  await f.DB.set('loans/one',{totalAmount:100,paidAmount:40});
  const before=plain(await f.BackupStore.snapshot());
  for(const input of [{}, {items:[{name:'No ID'}]}, {items:[{id:'a'}, {id:'a'}]}, {format:'mr-chicken-house-backup',version:2,cache:[{path:'items'}],pendingQueue:[]}, JSON.parse('{"items":{"__proto__":{"evil":true}}}')]) {
    await assert.rejects(f.BackupStore.restore(input));
    assert.equal((await f.DB.get('loans/one')).paidAmount,40);
    assert.deepEqual(plain(await f.IDB.queueGetAll()),before.pendingQueue);
  }
  f.IDB._db?.close();
});

test('restored offline snapshot uploads before remote download can replace it',async()=>{
  const f=fixture();
  await f.BackupStore.restore({items:[{id:'a',name:'Restored chicken'}],sales:[],categories:[]});
  f.context.navigator.onLine=true;
  const calls=[];
  f.context.fetch=async(_url, options={})=>{
    calls.push(options.method||'GET');
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>options.method?{ok:true,id:JSON.parse(options.body).__posCommand.id}:{items:{a:{name:'Restored chicken'}}}};
  };
  await f.Sync.pull();
  assert.deepEqual(calls,['PATCH','GET']);
  assert.equal(await f.IDB.queueCount(),0);
  assert.equal((await f.DB.get('items/a')).name,'Restored chicken');
  f.IDB._db?.close();
});
