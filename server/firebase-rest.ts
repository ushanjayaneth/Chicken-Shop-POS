import {cert} from 'firebase-admin/app';
import {parseServiceAccount} from './monitor/store.js';

type Connection = {base: string; credential: ReturnType<typeof cert>};
const connections = new WeakMap<NodeJS.ProcessEnv, Connection>();

export async function readFirebase(env: NodeJS.ProcessEnv, path: string, options: RequestInit = {}) {
  let connection = connections.get(env);
  if (!connection) {
    const base = new URL(env.FIREBASE_DATABASE_URL ?? '');
    if (base.protocol !== 'https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(base.hostname)
        || base.pathname !== '/' || base.port || base.username || base.password || base.search || base.hash) {
      throw new Error('Invalid Firebase database origin.');
    }
    connection = {base: base.origin, credential: cert(parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON ?? ''))};
    connections.set(env, connection);
  }
  const {access_token} = await connection.credential.getAccessToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + access_token);
  if (options.body) headers.set('Content-Type', 'application/json');
  return fetch(connection.base + '/' + path + '.json', {
    ...options, headers, redirect: 'error', signal: AbortSignal.timeout(12000),
  });
}

export async function firebaseValue(env: NodeJS.ProcessEnv, path: string): Promise<unknown> {
  const response = await readFirebase(env, path);
  if (!response.ok) throw new Error('Firebase could not read the workspace.');
  return response.json();
}
