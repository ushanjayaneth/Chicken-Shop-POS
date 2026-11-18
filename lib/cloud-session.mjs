import {createHmac, createHash, timingSafeEqual} from 'node:crypto';

const cookieName = 'chicken_cloud_session';
const sessionSeconds = 30 * 24 * 60 * 60;
const hash = value => createHash('sha256').update(value).digest();
const signature = (key, expiry) => createHmac('sha256', key).update('chicken-cloud:' + expiry).digest('base64url');

export function cloudKey(env = process.env) {
  const key = env.POS_ACCESS_KEY?.trim();
  return key?.length >= 24 ? key : null;
}

export function matchesKey(attempt, key) {
  return typeof attempt === 'string' && attempt.length <= 256 && timingSafeEqual(hash(attempt), hash(key));
}

export function sessionCookie(key, secure, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + sessionSeconds;
  return cookieName + '=' + expiry + '.' + signature(key, expiry) +
    '; Path=/api; Max-Age=' + sessionSeconds + '; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '');
}

export function hasSession(cookies, key, now = Date.now()) {
  const value = String(cookies || '').split(';').map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!value || !/^\d{10,12}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expiry, signed] = value.split('.');
  return Number(expiry) > Math.floor(now / 1000) && timingSafeEqual(Buffer.from(signed), Buffer.from(signature(key, expiry)));
}
