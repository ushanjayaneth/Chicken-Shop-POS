import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasSession, matchesKey, sessionCookie} from '../lib/cloud-session.mjs';
import dataHandler from '../api/data.js';
import sessionHandler from '../api/session.js';

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
  assert.equal(matchesKey(key,key), true);
  assert.equal(matchesKey(key+'x',key), false);
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

    const request = {method:'POST',socket:{},headers:{'content-type':'application/json','x-forwarded-proto':'https'}};
    assert.equal(sessionHandler({...request,body:{key:'wrong'}},response()).statusCode,401);
    const authorized = sessionHandler({...request,body:{key}},response());
    assert.equal(authorized.statusCode,200);
    assert.ok(hasSession(authorized.headers['Set-Cookie'],key));
  } finally {
    for (const [name,value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name]; else process.env[name]=value;
    }
    globalThis.fetch=fetchOriginal;
  }
});
