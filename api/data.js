import {commitToFirebase, pathParts} from '../lib/cloud-commit.mjs';
import {cloudKey, hasSession} from '../lib/cloud-session.mjs';
import {firebaseConfigured, firebaseTransport} from '../lib/firebase-transport.mjs';

const roots = new Set([
  'settings', 'categories', 'items', 'sales', 'loan_customers', 'loans',
  'coconut_purchases', 'coconut_husking', 'coconut_sales', 'coconut_copra', 'coconut_oil',
  'coconut_workers', 'coconut_worker_payments', 'cash_movements', 'day_ends'
]);

function validPath(path) {
  const parts = pathParts(path);
  if (!roots.has(parts[0]) || parts.some(part => /[\/%?&\u0000-\u001f\u007f]/.test(part))) {
    throw new Error('Invalid workspace record path.');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = cloudKey();
  if (!key || !firebaseConfigured()) {
    return res.status(503).json({error:'Cloud storage setup is incomplete.', code:'CLOUD_SETUP_REQUIRED'});
  }
  if (!hasSession(req.headers.cookie, key)) {
    return res.status(401).json({error:'Connect this device to the shared workspace.', code:'CLOUD_SIGN_IN_REQUIRED'});
  }
  if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(405).json({error:'Unsupported request method.'});
  }

  const path = req.query?.path ?? '';
  let body;
  let command;
  try {
    if (path !== '') validPath(path);
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (req.method === 'PATCH' && path === '') {
      command = body?.__posCommand;
      if (!command || !command.updates || typeof command.updates !== 'object' || Array.isArray(command.updates)) {
        return res.status(400).json({error:'A workspace sync command is required.'});
      }
      for (const updatePath of Object.keys(command.updates)) validPath(updatePath);
      if (command.guards !== undefined && !Array.isArray(command.guards)) {
        return res.status(400).json({error:'The workspace sync conditions are invalid.'});
      }
      for (const guard of command.guards || []) validPath(guard.path);
    } else if (path === '' && req.method !== 'GET') {
      return res.status(400).json({error:'Choose a workspace record.'});
    }
    if (req.method === 'PATCH' && path !== '') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid workspace patch.');
      for (const subpath of Object.keys(body)) validPath(path + '/' + subpath);
    }
  } catch {
    return res.status(400).json({error:'Invalid workspace request.'});
  }

  try {
    const {base, request} = await firebaseTransport();
    if (command) return res.status(200).json(await commitToFirebase(base, command, request));
    const destination = path.split('/').map(encodeURIComponent).join('/');
    const options = {method:req.method, headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(15000)};
    if (req.method === 'PUT' || req.method === 'PATCH') options.body = JSON.stringify(body ?? null);
    const response = await request(base + '/' + destination + '.json', options);
    if (!response.ok) return res.status(502).json({error:'Firebase rejected the cloud request.', code:'DATABASE_UNAVAILABLE'});
    const data = await response.json();
    if (path === '' && data && typeof data === 'object') {
      return res.status(200).json(Object.fromEntries(Object.entries(data).filter(([name]) => roots.has(name))));
    }
    return res.status(200).json(data);
  } catch (error) {
    if (error.code === 'SYNC_CONFLICT') return res.status(409).json({error:error.message, code:error.code});
    return res.status(502).json({error:'Firebase could not complete the cloud request.', code:'DATABASE_UNAVAILABLE'});
  }
}
