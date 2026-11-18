import {createSessionHandler} from '../api/session.js';

export const signingSecret = 'chicken-fixture-session-signing-secret';
export const testPin = '581672';
export function createPinFixture() {
  let value = null;
  let revision = 0;
  const request = async (url, options) => {
    if (new URL(url).pathname !== '/_pos_access.json') throw Error('Unexpected Firebase path');
    if (options.method !== 'PUT') return new Response(JSON.stringify(value), {headers:{etag:String(revision)}});
    if (options.headers['If-Match'] !== String(revision)) return new Response(null,{status:412});
    value = JSON.parse(options.body);
    revision++;
    return new Response(JSON.stringify(value));
  };
  return {
    read:()=>structuredClone(value),
    handler({hosted = false, now = Date.now} = {}) {
      return createSessionHandler({
        env:{POS_ACCESS_KEY:signingSecret,...(hosted ? {VERCEL:'1'} : {})},
        configured:()=>true,
        transport:async ()=>({base:'https://fixture.firebaseio.com',request}),
        now
      });
    }
  };
}
