import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasSession, sessionCookie} from '../lib/cloud-session.mjs';
import dataHandler from '../api/data.js';
import {createPinFixture, signingSecret, testPin} from './workspace-pin-fixture.mjs';

const key = 'test-workspace-access-key-for-local-fixtures';
const now = Date.UTC(2026,10,18);
function response() {
  return {
    headers:{},
    setHeader(name, value) {this.headers[name]=value;},
    status(code) {this.statusCode=code;return this;},
    json(data) {this.data=data;return this;}
  };
}

test('signed cloud session expires, rotates with the key and uses an HttpOnly cookie', () => {
  const cookie = sessionCookie(key, true, now);
  const value = cookie.split(';')[0];
  assert.match(cookie, /;\s*HttpOnly/);
  assert.match(cookie, /;\s*SameSite=Strict/);
  assert.match(cookie, /;\s*Secure/);
  assert.equal(hasSession(value,key,now), true);
  assert.equal(hasSession(value,key,now + 31 * 86400000), false);
  assert.equal(hasSession(value,key+'rotation',now), false);
  assert.equal(hasSession(value.replace(/\.[^;]+$/, '.' + 'a'.repeat(43)),key,now), false);
});

test('cloud API fails closed, with no Firebase traffic for an unsigned request', async () => {
  const originals = Object.fromEntries(['POS_ACCESS_KEY','FIREBASE_DATABASE_URL','FIREBASE_SERVICE_ACCOUNT_JSON'].map(name => [name,process.env[name]]));
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Unexpected network request')};
  try {
    delete process.env.POS_ACCESS_KEY;
    const pending = await dataHandler({method:'GET',headers:{}},response());
    assert.equal(pending.statusCode,503);
    process.env.POS_ACCESS_KEY=key;
    process.env.FIREBASE_DATABASE_URL='https://fixture.firebaseio.com';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON='{}';
    const denied = await dataHandler({method:'DELETE',headers:{},query:{path:'items'}},response());
    assert.equal(denied.statusCode,401);
    const invalid = await dataHandler({method:'DELETE',headers:{cookie:sessionCookie(key,false)},query:{path:''}},response());
    assert.equal(invalid.statusCode,400);

  } finally {
    for (const [name,value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name]; else process.env[name]=value;
    }
    globalThis.fetch=fetchOriginal;
  }
});

function sessionRequest(method, body, cookie = '') {
  return {
    method, body, socket:{remoteAddress:'127.0.0.1'},
    headers:{'content-type':'application/json','x-vercel-forwarded-for':'203.0.113.9',cookie}
  };
}

test('starter PIN is local only, and Settings opens both local and hosted access with a changed PIN', async () => {
  const store = createPinFixture();
  const local = store.handler({now:()=>now});
  const hosted = store.handler({hosted:true,now:()=>now});
  const setup = await hosted(sessionRequest('POST',{pin:'1234'}),response());
  assert.equal(setup.statusCode,409);
  assert.equal(store.read(),null);
  const signedIn = await local(sessionRequest('POST',{pin:'1234'}),response());
  assert.equal(signedIn.statusCode,200);
  const cookie = signedIn.headers['Set-Cookie'];
  assert.ok(hasSession(cookie,signingSecret,now));
  const change = {currentPin:'1234',nextPin:testPin};
  assert.equal((await local(sessionRequest('PATCH',change),response())).statusCode,401);
  assert.equal((await local(sessionRequest('PATCH',{...change,nextPin:'000000'},cookie),response())).statusCode,400);
  assert.equal((await local(sessionRequest('PATCH',change,cookie),response())).statusCode,200);
  assert.ok(store.read().pinHash);
  assert.equal(Object.values(store.read()).includes(testPin),false);
  assert.equal((await hosted(sessionRequest('POST',{pin:'1234'}),response())).statusCode,401);
  const accepted = await hosted(sessionRequest('POST',{pin:testPin}),response());
  assert.equal(accepted.statusCode,200);
  assert.match(accepted.headers['Set-Cookie'], /;\s*Secure/);
});

test('PIN attempt limits are shared across hosted handlers and recover after expiry', async () => {
  let clock = now;
  const store = createPinFixture();
  const local = store.handler({now:()=>clock});
  const hosted = store.handler({hosted:true,now:()=>clock});
  const secondHosted = store.handler({hosted:true,now:()=>clock});
  const cookie = sessionCookie(signingSecret,false,clock);
  assert.equal((await local(sessionRequest('PATCH',{currentPin:'1234',nextPin:testPin},cookie),response())).statusCode,200);
  const entries = await Promise.all(Array.from({length:5},(_,index) =>
    (index % 2 ? hosted : secondHosted)(sessionRequest('POST',{pin:'9876'}),response())));
  assert.ok(entries.every(entry=>entry.statusCode===401));
  const rateLimited = await hosted(sessionRequest('POST',{pin:testPin}),response());
  assert.equal(rateLimited.statusCode,429);
  assert.equal(rateLimited.headers['Retry-After'],'600');
  clock += 10 * 60 * 1000;
  assert.equal((await secondHosted(sessionRequest('POST',{pin:testPin}),response())).statusCode,200);
});
