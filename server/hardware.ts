import {lookup} from 'node:dns/promises';
import {randomUUID} from 'node:crypto';
import {createConnection, isIP, type Socket} from 'node:net';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {User} from '../shared/types';
import {ApiError} from './database';
import {permit} from './security';
import {selectPrivatePrinterAddress, validatePrinterTarget} from './peripherals';
import {createScannerLineDecoder, escPosText} from '../src/lib/peripherals';

/** Resolve once, reject public/mixed DNS, and pin the validated LAN address. */
export async function resolveHardwareTarget(host: string, port: number) {
  const target = validatePrinterTarget(host, port);
  if (isIP(target.host)) return {...target, address: target.host};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(target.host, {all: true, verbatim: true}),
      new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new ApiError(504, 'LAN hardware hostname lookup timed out.')), 1500);}),
    ]);
    return {...target, address: selectPrivatePrinterAddress(addresses)};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'The LAN hardware hostname could not be resolved.');
  } finally {if (timer) clearTimeout(timer);}
}

/** One explicit write. Never retry after bytes may have reached the printer. */
export async function sendNetworkReceipt(host: string, port: number, text: string) {
  const bytes = escPosText(text);
  const target = await resolveHardwareTarget(host, port);
  return new Promise<{sent: true; bytes: number; message: string}>((resolve, reject) => {
    const socket = createConnection({host: target.address, port: target.port, family: 4});
    let settled = false;
    const fail = () => {if (settled) return; settled = true; socket.destroy(); reject(new ApiError(502, 'The printer connection failed. Check the paper before retrying; part of the receipt may have been sent.'));};
    socket.setTimeout(5000);
    socket.once('timeout', fail); socket.once('error', fail);
    socket.once('connect', () => {socket.end(bytes, () => {
      if (settled) return;
      settled = true; socket.destroy();
      resolve({sent: true, bytes: bytes.length, message: 'Receipt bytes sent to the TCP printer. Physical paper output is not confirmed.'});
    });});
  });
}

interface ScannerSession {id: string; sequence: number; socket: Socket; connected: boolean; message: string; scans: {id: number; value: string; receivedAt: string}[]; seen: number; target: string}
export class NetworkScanners {
  private sessions = new Map<string, ScannerSession>();
  private pending = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  constructor() {
    this.timer = setInterval(() => {for (const [key, session] of this.sessions) if (Date.now() - session.seen > 30000) this.disconnect(key);}, 10000);
    this.timer.unref();
  }
  async connect(key: string, host: string, port: number) {
    if (this.pending.has(key)) throw new ApiError(409, 'Scanner connection is already in progress.');
    const current = this.sessions.get(key);
    if (current?.connected && current.target === `${host}:${port}`) {current.seen = Date.now(); return {connected: true, sessionId: current.id};}
    if (this.sessions.size >= 50 && !current) throw new ApiError(429, 'Too many scanner channels are open on this hub.');
    this.pending.add(key);
    try {
      const target = await resolveHardwareTarget(host, port);
      this.disconnect(key);
      const socket = createConnection({host: target.address, port: target.port, family: 4});
      const session: ScannerSession = {id: randomUUID(), sequence: 0, socket, connected: false, message: 'Connecting...', scans: [], seen: Date.now(), target: `${host}:${port}`};
      this.sessions.set(key, session);
      const feed = createScannerLineDecoder(value => {
        if (session.scans.length >= 100) {session.connected = false; session.message = 'Scanner queue overflow. Reconnect and rescan the missing items.'; socket.destroy(); return;}
        session.scans.push({id: ++session.sequence, value, receivedAt: new Date().toISOString()});
      });
      socket.on('data', data => feed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
      socket.on('error', () => {session.connected = false; session.message = 'LAN scanner disconnected. Check scanner power and its TCP server configuration.';});
      socket.on('close', () => {session.connected = false; if (session.message === 'Connected') session.message = 'LAN scanner disconnected.';});
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {socket.destroy(); reject(new ApiError(504, 'The LAN scanner did not respond within 2 seconds.'));}, 2000);
        const connected = () => {clearTimeout(timer); socket.removeListener('error', failed); session.connected = true; session.message = 'Connected'; resolve();};
        const failed = () => {clearTimeout(timer); socket.removeListener('connect', connected); reject(new ApiError(502, 'Could not open the LAN scanner TCP channel.'));};
        socket.once('connect', connected); socket.once('error', failed);
      });
      return {connected: true, sessionId: session.id};
    } finally {this.pending.delete(key);}
  }
  read(key: string, after = 0) {
    const session = this.sessions.get(key);
    if (!session) return {connected: false, message: 'No LAN scanner channel is open.', scans: []};
    session.seen = Date.now();
    // Acknowledge only the preceding response. A failed HTTP response can be fetched again.
    session.scans = session.scans.filter(scan => scan.id > after);
    return {connected: session.connected, message: session.message, scans: session.scans.slice(0, 100)};
  }
  disconnect(key: string) {const session = this.sessions.get(key); if (session) {this.sessions.delete(key); session.socket.destroy();} return {connected: false};}
  close() {clearInterval(this.timer); for (const key of this.sessions.keys()) this.disconnect(key);}
}

const identity = z.object({branchId: z.string().min(1).max(160), clientId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/)});
const targetSchema = z.object({host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65535)});
export function registerHardwareRoutes(app: FastifyInstance, access: {getUser: (request: FastifyRequest) => User; scoped: (user: User, branchId: string) => unknown}) {
  const scanners = new NetworkScanners();
  app.addHook('onClose', async () => {scanners.close();});
  function userScope(request: FastifyRequest, branchId: string) {const user = access.getUser(request); permit(user, ['owner', 'manager', 'cashier']); access.scoped(user, branchId); return user;}
  const keyFor = (user: User, body: {branchId: string; clientId: string}) => `${user.id}:${body.branchId}:${body.clientId}`;
  app.post('/api/devices/raw-print', async request => {
    const body = targetSchema.extend({branchId: z.string().min(1).max(160), text: z.string().min(1).max(16000)}).parse(request.body);
    userScope(request, body.branchId);
    return sendNetworkReceipt(body.host, body.port, body.text);
  });
  app.post('/api/devices/scanner/connect', async request => {
    const body = identity.extend(targetSchema.shape).parse(request.body);
    const user = userScope(request, body.branchId);
    return scanners.connect(keyFor(user, body), body.host, body.port);
  });
  app.get('/api/devices/scanner/status', async request => {
    const body = identity.extend({after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)}).parse(request.query); const user = userScope(request, body.branchId);
    return scanners.read(keyFor(user, body), body.after);
  });
  app.post('/api/devices/scanner/disconnect', async request => {
    const body = identity.parse(request.body); const user = userScope(request, body.branchId);
    return scanners.disconnect(keyFor(user, body));
  });
}
