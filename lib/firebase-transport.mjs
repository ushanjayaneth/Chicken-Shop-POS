import {JWT} from 'google-auth-library';

const databaseScopes = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email'
];
let source;
let client;

export function firebaseConfigured(env = process.env) {
  return Boolean(env.FIREBASE_DATABASE_URL && env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

export async function firebaseTransport(env = process.env) {
  if (!firebaseConfigured(env)) throw new Error('Firebase connection is missing server configuration.');
  const base = new URL(env.FIREBASE_DATABASE_URL);
  if (base.protocol !== 'https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(base.hostname) ||
      base.username || base.password || base.pathname !== '/' || base.port || base.search || base.hash) {
    throw new Error('Firebase database URL is invalid.');
  }
  if (source !== env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!credentials.client_email || !credentials.private_key) throw new Error('Firebase service account is invalid.');
    client = new JWT({email:credentials.client_email, key:credentials.private_key, scopes:databaseScopes});
    source = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }

  return {
    base: base.origin,
    async request(url, options) {
      const headers = new Headers(options.headers);
      const {token} = await client.getAccessToken();
      if (!token) throw new Error('Firebase authorization could not be established.');
      headers.set('Authorization', 'Bearer ' + token);
      return fetch(url, {...options, headers, redirect:'error'});
    }
  };
}
