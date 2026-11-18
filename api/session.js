import {cloudKey, matchesKey, sessionCookie} from '../lib/cloud-session.mjs';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json')) {
    return res.status(405).json({error:'Use the workspace sign-in form.'});
  }
  const key = cloudKey();
  if (!key) return res.status(503).json({error:'Cloud access has not been configured.'});
  let body;
  try {body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;}
  catch {return res.status(400).json({error:'The workspace sign-in request is invalid.'});}
  if (!matchesKey(body?.key, key)) {
    return res.status(401).json({error:'The workspace access key is incorrect.'});
  }
  const secure = process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  res.setHeader('Set-Cookie', sessionCookie(key, secure));
  return res.status(200).json({ok:true});
}
