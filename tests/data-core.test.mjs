import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

function fixture() {
  const badge = {dataset:{},className:'',title:'',setAttribute(){}};
  let lock = Promise.resolve();
  const context = vm.createContext({
    indexedDB:new IDBFactory(), IDBKeyRange, structuredClone, crypto:globalThis.crypto, AbortSignal,
    console:{warn(){}}, setInterval, clearInterval,
    navigator:{onLine:false,locks:{request(_name,action){const run=lock.then(action);lock=run.catch(()=>{});return run;}}},
    document:{getElementById(){return badge;}},window:{addEventListener(){}},
    S:{settings:{currency:'Rs.',apiServerUrl:''}},
    normalizeReceiptNote:value=>value||'',loadAll:async()=>{},scheduleDataRefresh(){},
    getApiUrl:path=>'https://fixture.test/api/data/'+path,
    fetch:async()=>{throw new Error('No fixture response');}
  });
  vm.runInContext(readFileSync('data-core.js','utf8')+'\nglobalThis.testAPI={IDB,DB,Sync,CacheTree,localBusinessDate};',context);
  return {context,...context.testAPI,badge};
}
const plain = value => JSON.parse(JSON.stringify(value));
const response = (data,status=200,type='application/json') => ({ok:status>=200&&status<300,status,headers:{get:()=>type},json:async()=>data});

test('record, stock and pending cloud operation commit atomically and stale stock rejects without partial writes',async()=>{
  const f=fixture();
  await f.IDB.cacheSet('items/a',{name:'Chicken',stockBatches:[{quantity:5}]});
  await f.DB.batch([{type:'patch',path:'items/a',expected:{stockBatches:[{quantity:5}]},data:{stockBatches:[{quantity:3}]}},{type:'set',path:'sales/one',data:{total:200}}]);
  assert.equal((await f.DB.get('items')).a.stockBatches[0].quantity,3);
  assert.equal((await f.DB.get('sales')).one.total,200);
  assert.equal(await f.IDB.queueCount(),1);
  await assert.rejects(f.DB.batch([{type:'set',path:'sales/bad',data:{total:100}},{type:'patch',path:'items/a',expected:{stockBatches:[{quantity:5}]},data:{stockBatches:[]}}]),/changed on another screen/);
  assert.equal((await f.DB.get('sales')).bad,undefined);
  assert.equal(await f.IDB.queueCount(),1);
  f.IDB._db.close();
});

test('concurrent patches retain fields, nested settings and authoritative parent values',async()=>{
  const f=fixture();
  await f.IDB.cacheSet('items/a',{name:'Chicken',price:100});
  await Promise.all([f.DB.patch('items/a',{price:120}),f.DB.patch('items/a',{name:'Fresh chicken'})]);
  assert.deepEqual(plain(await f.DB.get('items/a')),{name:'Fresh chicken',price:120});
  await f.DB.set('settings/main/coconutOpeningFloats/2026-11-15',1000);
  assert.equal((await f.DB.get('settings/main')).coconutOpeningFloats['2026-11-15'],1000);
  await f.IDB.cacheSet('items',{a:{name:'Remote fresh',price:150}});
  assert.equal((await f.DB.get('items/a')).name,'Remote fresh');
  await f.DB.del('items/a');
  assert.deepEqual(plain(await f.DB.get('items')),{});
  f.IDB._db.close();
});

test('simultaneous flushes send each durable batch once and acknowledge JSON only',async()=>{
  const f=fixture();
  await f.DB.batch([{type:'set',path:'sales/one',data:{total:100}},{type:'patch',path:'items/a',data:{price:100}}]);
  await f.Sync.flush();
  f.context.navigator.onLine=true;
  const requests=[];
  f.context.fetch=async(url,options)=>{requests.push({url,options});await new Promise(resolve=>setTimeout(resolve,15));const command=JSON.parse(options.body).__posCommand;return response({ok:true,id:command.id});};
  await Promise.all([f.Sync.flush(),f.Sync.flush()]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.method,'PATCH');
  assert.equal(JSON.parse(requests[0].options.body).__posCommand.updates['sales/one'].total,100);
  assert.equal(await f.IDB.queueCount(),0);
  f.context.navigator.onLine=false;
  await f.DB.set('sales/two',{total:200});await f.Sync.flush();
  f.context.navigator.onLine=true;
  f.context.fetch=async()=>response({});
  assert.equal(await f.Sync.flush(),false);
  assert.equal(await f.IDB.queueCount(),1);
  f.context.fetch=async()=>response({},200,'text/html');
  assert.equal(await f.Sync.flush(),false);
  assert.equal(await f.IDB.queueCount(),1);
  f.IDB._db.close();
});

test('failed upload and a write during remote download preserve pending local records',async()=>{
  const f=fixture();
  await f.DB.set('items/a',{stockBatches:[{quantity:3}]});await f.Sync.flush();
  f.context.navigator.onLine=true;
  f.context.fetch=async()=>response({},500);
  assert.equal(await f.Sync.pull(),false);
  assert.equal((await f.DB.get('items/a')).stockBatches[0].quantity,3);
  const queue=await f.IDB.queueGetAll();for(const op of queue)await f.IDB.queueDelete(op.id);
  let download;
  f.context.fetch=async(_url, options)=>options?.method ? response({}) : new Promise(resolve=>{download=resolve;});
  const pull=f.Sync.pull();
  while(!download) await new Promise(resolve=>setTimeout(resolve,1));
  await f.DB.set('items/a',{stockBatches:[{quantity:2}]});
  download(response({items:{a:{stockBatches:[{quantity:5}]}}}));
  await pull;
  assert.equal((await f.DB.get('items/a')).stockBatches[0].quantity,2);
  f.context.fetch=async(_url,options)=>response({ok:true,id:JSON.parse(options.body).__posCommand.id});await f.Sync.flush();
  f.IDB._db.close();
});

test('remote deletions replace stale collections and local business dates use Colombo',async()=>{
  const f=fixture();
  await f.IDB.cacheSet('items',{a:{price:100},removed:{price:200}});
  f.context.navigator.onLine=true;
  f.context.fetch=async()=>response({items:{a:{price:150}}});
  assert.equal(await f.Sync.pull(),true);
  assert.deepEqual(plain(await f.DB.get('items')),{a:{price:150}});
  f.context.fetch=async()=>response({});await f.Sync.pull();
  assert.deepEqual(plain(await f.DB.get('items')),{});
  assert.equal(f.localBusinessDate('2026-11-14T20:00:00Z'),'2026-11-15');
  assert.equal(f.localBusinessDate('2026-11-15'),'2026-11-15');
  f.IDB._db.close();
});