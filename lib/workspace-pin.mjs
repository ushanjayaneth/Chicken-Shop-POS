import {createHmac, timingSafeEqual} from 'node:crypto';

const windowMs = 10 * 60 * 1000;
const starterPin = '1234';
const digest = (secret, kind, value) => createHmac('sha256', secret).update(kind + ':' + value).digest('hex');
const validPin = value => typeof value === 'string' && /^\d{4,12}$/.test(value);
const activeAttempt = (entry, now) => entry?.until > now ? entry : {count:0, until:now + windowMs};

function checkPin(record, secret, pin, local) {
  if (!record?.pinHash) return local && pin === starterPin;
  const storedHash = Buffer.from(record.pinHash, 'hex');
  const submittedHash = Buffer.from(digest(secret,'pin',pin),'hex');
  return storedHash.length === submittedHash.length && timingSafeEqual(storedHash, submittedHash);
}

export function validatePinRequest(pin, nextPin) {
  if (!validPin(pin)) return 'Enter a valid workspace PIN.';
  if (nextPin === undefined) return null;
  if (!validPin(nextPin) || nextPin.length < 6 || /^(\d)\1+$/.test(nextPin) || '01234567890123456789'.includes(nextPin) || '98765432109876543210'.includes(nextPin)) {
    return 'Choose a 6 to 12 digit PIN. Avoid repeated or consecutive digits.';
  }
  if (pin === nextPin) return 'Choose a different PIN.';
  return null;
}

export async function applyPinRequest(transport, secret, {pin, nextPin, local, clientAddress, now}) {
  const path = transport.base + '/_pos_access.json';
  const device = local ? 'local' : digest(secret,'address',clientAddress);
  for (let attempt = 0; attempt < 6; attempt++) {
    const read = await transport.request(path,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(7000)});
    if (!read.ok) throw new Error('Unable to read workspace access settings.');
    const record = await read.json() || {};
    if (!record.pinHash && !local) {
      return {status:409,error:'Set a new Workspace PIN from Settings on the shop PC, then connect this device.'};
    }

    const devices = Object.fromEntries(Object.entries(record.attempts || {}).filter(([,value]) => value.until > now));
    const deviceAttempts = activeAttempt(devices[device], now);
    const networkAttempts = activeAttempt(record.networkAttempts, now);
    const blockedUntil = Math.max(deviceAttempts.count >= 5 ? deviceAttempts.until : 0, !local && networkAttempts.count >= 20 ? networkAttempts.until : 0);
    if (blockedUntil > now) {
      const retryAfter = Math.ceil((blockedUntil - now) / 1000);
      return {status:429,error:'Too many incorrect PIN attempts. Try again in ' + Math.ceil(retryAfter / 60) + ' minute(s).',retryAfter};
    }

    const correct = checkPin(record,secret,pin,local);
    if (correct && nextPin === undefined && !devices[device]) return {status:200};

    let updated;
    if (correct && nextPin !== undefined) {
      updated = {pinHash:digest(secret,'pin',nextPin),updatedAt:now};
    } else {
      if (correct) delete devices[device];
      else devices[device] = {...deviceAttempts,count:deviceAttempts.count + 1};
      updated = {...record,attempts:devices};
      if (!correct && !local) updated.networkAttempts = {...networkAttempts,count:networkAttempts.count + 1};
    }
    const etag = read.headers.get('etag');
    if (!etag) throw new Error('Unable to verify workspace access version.');
    const write = await transport.request(path,{
      method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},
      body:JSON.stringify(updated),signal:AbortSignal.timeout(7000)
    });
    if (write.status === 412) continue;
    if (!write.ok) throw new Error('Unable to save workspace access settings.');
    return correct ? {status:200} : {status:401,error:'The workspace PIN is incorrect.'};
  }
  return {status:503,error:'Workspace access is busy. Try again shortly.'};
}
