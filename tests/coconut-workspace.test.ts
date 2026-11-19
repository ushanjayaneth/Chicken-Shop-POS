import assert from 'node:assert/strict';
import test from 'node:test';
import {applyCoconutCommand, coconutSnapshot, publicSnapshot} from '../shared/coconut/workspace.mjs';
import {createCoconutHandler} from '../server/coconut.js';
import {createMonitorHandler} from '../server/monitor/handler.js';
import {MemoryMonitorStore} from '../server/monitor/store.js';
import {scryptSync} from 'node:crypto';

test('legacy Coconut import excludes shop sales, shop cash, and private settings', () => {
  const snapshot = coconutSnapshot({
    items:{shop:{name:'Shop stock'}}, sales:{shop:{}},
    cash_movements:{shop:{source:'sale'}, coconut:{source:'coconut_buy'}},
    day_ends:{shop:{type:'shop'}, coconut:{type:'coconut'}},
    settings:{main:{pin:'old credential', coconutOpeningFloats:{'2026-11-19':4000}}},
  }, {shopName:'Mr. Chicken House'});
  assert.deepEqual(Object.keys(snapshot.cash_movements as object), ['coconut']);
  assert.deepEqual(Object.keys(snapshot.day_ends as object), ['coconut']);
  assert.equal(snapshot.items, undefined);
  assert.equal(snapshot.sales, undefined);
  assert.deepEqual(snapshot.settings,{main:{shopName:'Mr. Chicken House',coconutOpeningFloats:{'2026-11-19':4000}}});
});

test('offline Coconut purchases replay once and concurrent overselling is refused', () => {
  const original = coconutSnapshot({}, {});
  const path = 'coconut_purchases/purchase';
  const purchase = {id:'purchase-opening', updates:{[path]:{date:'2026-11-19',largeCount:12,smallCount:0,total:1200}}, expected:{[path]:null}};
  const first = applyCoconutCommand(original,purchase);
  assert.equal(applyCoconutCommand(first.snapshot,purchase).replayed,true);
  assert.equal(publicSnapshot(first.snapshot)._pos_commits,undefined);
  const sell = (id:string) => {
    const path = 'coconut_sales/' + id;
    return {id, updates:{[path]:{type:'unhusked',date:'2026-11-19',largeCount:11,smallCount:0,qty:11}}, expected:{[path]:null}};
  };
  const accepted = applyCoconutCommand(first.snapshot,sell('sale-device-one'));
  assert.throws(()=>applyCoconutCommand(accepted.snapshot,sell('sale-device-two')), /Available .* changed/);
  assert.throws(()=>applyCoconutCommand(accepted.snapshot,{id:'wrong-collection',updates:{'items/item':{name:'Shop stock'}},expected:{'items/item':null}}), /Invalid coconut record/);
});

test('shop and Coconut sessions do not grant access to the other workspace', async () => {
  const salt = Buffer.alloc(32, 31);
  const coconutPin = '30467821';
  const env = {
    CLOUD_POS_PIN:'61978201',
    COCONUT_POS_PIN_HASH:['scrypt',salt.toString('hex'),scryptSync(coconutPin,salt,64).toString('hex')].join('$'),
    CLOUD_SESSION_SECRET:'test-only-cookie-signing-secret-with-at-least-32-characters',
  };
  const shop = createMonitorHandler({env,store:new MemoryMonitorStore()});
  const coconut = createCoconutHandler({env,store:new MemoryMonitorStore()});
  const post = (route: string, pin: string) => new Request('https://shop.test/api/'+route+'?action=pos-login',{
    method:'POST', headers:{origin:'https://shop.test','content-type':'application/json'}, body:JSON.stringify({pin}),
  });
  const shopLogin = await shop(post('cloud',env.CLOUD_POS_PIN));
  const coconutLogin = await coconut(post('coconut',coconutPin));
  assert.equal(shopLogin.status,200);
  assert.equal(coconutLogin.status,200);
  const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  const wrongSession = await shop(new Request('https://shop.test/api/cloud?action=pos-session',{headers:{cookie:cookie(coconutLogin)}}));
  assert.equal((await wrongSession.json()).authenticated,false);
  assert.equal((await coconut(new Request('https://shop.test/api/coconut?action=snapshot',{headers:{cookie:cookie(shopLogin)}}))).status,401);
});
