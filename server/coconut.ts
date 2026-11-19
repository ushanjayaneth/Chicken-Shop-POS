import {chickenShop} from '../shared/chicken-shop.js';
import {applyCoconutCommand, coconutSnapshot, ledgerCollections, publicSnapshot, validateCommand, type CoconutSnapshot} from '../shared/coconut/workspace.mjs';
import {firebaseValue, readFirebase} from './firebase-rest.js';
import {createMonitorHandler, type MonitorOptions} from './monitor/handler.js';

const workspacePath = 'chickenWorkspaces/coconut';
const settings = {shopName: chickenShop.name, currency: 'Rs.', address: chickenShop.address, phone: chickenShop.phone};

async function legacyCoconut(env: NodeJS.ProcessEnv) {
  const entries = await Promise.all([...ledgerCollections, 'settings/main/coconutOpeningFloats']
    .map(async collection => [collection, await firebaseValue(env, collection)] as const));
  const source = Object.fromEntries(entries);
  source.settings = {main: {coconutOpeningFloats: source['settings/main/coconutOpeningFloats']}};
  return coconutSnapshot(source, settings);
}

export function createCoconutHandler(options: MonitorOptions = {}) {
  const env = options.env ?? process.env;
  const auth = createMonitorHandler({
    store: options.store,
    cookieName: 'chicken-coconut',
    env: {
      FIREBASE_DATABASE_URL: env.FIREBASE_DATABASE_URL,
      FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      CLOUD_TENANT_ID: 'chicken-coconut-auth',
      CLOUD_POS_PIN_HASH: env.COCONUT_POS_PIN_HASH,
      CLOUD_SESSION_SECRET: env.CLOUD_SESSION_SECRET,
    },
  });
  return async (request: Request) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') ?? 'status';
    const reply = (value: unknown, status = 200) => Response.json(value, {
      status, headers: {'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff'},
    });
    try {
      if (['status', 'pos-session', 'pos-login', 'pos-logout'].includes(action)) return auth(request);
      if (action !== 'snapshot' || !['GET', 'POST'].includes(request.method)) return reply({error:'Unknown coconut operation.'}, 404);
      const sessionUrl = new URL(url);
      sessionUrl.searchParams.set('action', 'pos-session');
      const session = await auth(new Request(sessionUrl, {headers: request.headers}));
      if (!session.ok) return session;
      if (!(await session.json()).authenticated) return reply({error:'Enter the Coconut PIN to sync this workspace.'}, 401);
      const mutate = request.method === 'POST';
      if (mutate && request.headers.get('origin') !== url.origin) return reply({error:'Request origin is invalid.'},403);
      const command: unknown = mutate ? await request.json().catch(() => null) : null;
      if (mutate) {
        try { validateCommand(command); }
        catch (error) { return reply({error: (error as Error).message}, 400); }
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await readFirebase(env, workspacePath, {headers: {'X-Firebase-ETag':'true'}});
        if (!response.ok) throw new Error('Workspace read failed.');
        const stored = await response.json() as {json: string} | null;
        const snapshot: CoconutSnapshot = stored ? JSON.parse(stored.json) : await legacyCoconut(env);
        if (!mutate) return reply(publicSnapshot(snapshot));
        validateCommand(command);
        const next = applyCoconutCommand(snapshot, command);
        if (next.replayed) return reply(publicSnapshot(snapshot));
        const etag = response.headers.get('etag');
        if (!etag) throw new Error('Missing workspace version.');
        const write = await readFirebase(env, workspacePath, {
          method: 'PUT', headers: {'If-Match': etag}, body: JSON.stringify({json: JSON.stringify(next.snapshot)}),
        });
        if (write.status === 412) continue;
        if (!write.ok) throw new Error('Workspace write failed.');
        return reply(publicSnapshot(next.snapshot));
      }
      return reply({error:'Cloud is busy. This device will retry the saved entry.'}, 503);
    } catch (error) {
      if ((error as {code?: string}).code === 'SYNC_CONFLICT') return reply({error:(error as Error).message},409);
      return reply({error:'Coconut cloud storage is unavailable. Saved entries stay on this device.'},502);
    }
  };
}
