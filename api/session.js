import {cloudKey, hasSession, sessionCookie} from '../lib/cloud-session.mjs';
import {firebaseConfigured, firebaseTransport} from '../lib/firebase-transport.mjs';
import {applyPinRequest, validatePinRequest} from '../lib/workspace-pin.mjs';

const loopback = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

export function createSessionHandler({env = process.env, transport = firebaseTransport, configured = firebaseConfigured, now = Date.now} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control','no-store');
    if (!['POST','PATCH'].includes(req.method) || !String(req.headers['content-type']).startsWith('application/json')) {
      return res.status(405).json({error:'Use the workspace sign-in or settings form.'});
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({error:'Open the POS to manage workspace access.'});
    }
    const secret = cloudKey(env);
    if (!secret || !configured(env)) return res.status(503).json({error:'Cloud access has not been configured.'});

    const changingPin = req.method === 'PATCH';
    if (changingPin && !hasSession(req.headers.cookie,secret,now())) {
      return res.status(401).json({error:'Connect this device before changing the workspace PIN.'});
    }
    let body;
    try {body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;}
    catch {return res.status(400).json({error:'The workspace PIN request is invalid.'});}
    const pin = changingPin ? body?.currentPin : (body?.pin ?? body?.key);
    const nextPin = changingPin ? (body?.nextPin ?? '') : undefined;
    const invalid = validatePinRequest(pin,nextPin);
    if (invalid) return res.status(400).json({error:invalid});

    const hosted = Boolean(env.VERCEL || env.VERCEL_ENV);
    const local = !hosted && loopback.has(req.socket?.remoteAddress);
    const clientAddress = hosted ? (req.headers['x-vercel-forwarded-for'] || 'unknown') : (req.socket?.remoteAddress || 'unknown');
    try {
      const result = await applyPinRequest(await transport(env), secret, {pin,nextPin,local,clientAddress,now:now()});
      if (result.retryAfter) res.setHeader('Retry-After',String(result.retryAfter));
      if (result.status !== 200) return res.status(result.status).json({error:result.error});
      const secure = hosted || Boolean(req.socket?.encrypted);
      res.setHeader('Set-Cookie',sessionCookie(secret,secure,now()));
      return res.status(200).json({ok:true});
    } catch {
      return res.status(502).json({error:'Workspace access could not reach the cloud. Try again shortly.'});
    }
  };
}

export default createSessionHandler();
