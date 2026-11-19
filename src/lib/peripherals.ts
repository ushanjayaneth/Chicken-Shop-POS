export interface PrinterPreference {
  selectedPrinterId: string;
  selectedPrinterName: string;
  networkHost: string;
  networkPort: number;
}

const emptyPreference: PrinterPreference = {selectedPrinterId: '', selectedPrinterName: '', networkHost: '', networkPort: 9100};

export function loadPrinterPreference(branchId: string): PrinterPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(`retail-printer-${branchId}`) || '{}') as Partial<PrinterPreference>;
    return {
      selectedPrinterId: typeof saved.selectedPrinterId === 'string' ? saved.selectedPrinterId.slice(0, 120) : '',
      selectedPrinterName: typeof saved.selectedPrinterName === 'string' ? saved.selectedPrinterName.slice(0, 240) : '',
      networkHost: typeof saved.networkHost === 'string' ? saved.networkHost.slice(0, 253) : '',
      networkPort: typeof saved.networkPort === 'number' && Number.isInteger(saved.networkPort) && saved.networkPort > 0 && saved.networkPort <= 65535 ? saved.networkPort : 9100,
    };
  } catch {return {...emptyPreference};}
}

export function savePrinterPreference(branchId: string, preference: PrinterPreference) {
  localStorage.setItem(`retail-printer-${branchId}`, JSON.stringify(preference));
}

export interface HIDInputReportLike extends Event {data: DataView; reportId: number}
export interface HIDDeviceLike extends EventTarget {
  opened: boolean;
  productName: string;
  vendorId: number;
  productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
}
export interface HIDConnectionLike extends Event {device: HIDDeviceLike}
export interface HIDManagerLike extends EventTarget {
  getDevices(): Promise<HIDDeviceLike[]>;
  requestDevice(options: {filters: {vendorId?: number; productId?: number; usagePage?: number; usage?: number}[]}): Promise<HIDDeviceLike[]>;
}

export function browserHID(): HIDManagerLike | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || !window.isSecureContext) return null;
  return (navigator as Navigator & {hid?: HIDManagerLike}).hid || null;
}

export function hidDeviceKey(device: HIDDeviceLike) {
  return `${device.vendorId}:${device.productId}:${device.productName}`;
}

export interface ScannerInputResult {value: string; elapsedMs: number | null; scannerLike: boolean; receivedAt: string}

/** Timing identifies rapid input, not the physical presence of a keyboard scanner. */
export function classifyScannerInput(value: string, elapsedMs: number | null, keyCount: number, pasted = false): ScannerInputResult {
  const code = value.trim();
  if (!code || code.length > 256 || /[\u0000-\u001f\u007f]/.test(code)) throw new Error('Scan a printable product code between 1 and 256 characters.');
  const timed = typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs > 0;
  const scannerLike = !pasted && code.length >= 4 && keyCount >= code.length && timed && elapsedMs <= Math.min(1500, code.length * 80);
  return {value: code, elapsedMs: timed ? Math.round(elapsedMs) : null, scannerLike, receivedAt: new Date().toISOString()};
}

export type PeripheralRole = 'printer' | 'scanner';
export type PeripheralTransport = 'browser' | 'keyboard' | 'usb' | 'serial' | 'bluetooth' | 'lan';
export interface PeripheralProfile {
  transport: PeripheralTransport;
  autoReconnect: boolean;
  name: string;
  deviceId: string;
  vendorId?: number;
  productId?: number;
  serialNumber?: string;
  bluetoothServiceClassId?: string;
  baudRate: number;
  serviceUuid: string;
  characteristicUuid: string;
  host: string;
  port: number;
}
export interface HardwarePreference {version: 1; clientId: string; printer: PeripheralProfile; scanner: PeripheralProfile}
export interface PeripheralStatus {state: 'connected' | 'disconnected' | 'connecting' | 'unknown'; message: string; name: string}
export interface HardwareStatus {printer: PeripheralStatus; scanner: PeripheralStatus; lastScan: ScannerCode | null}
export interface ScannerCode {value: string; source: 'serial' | 'bluetooth' | 'lan'; receivedAt: string}
export const SCANNER_EVENT = 'retail:scanner-code';

const profileDefault = (role: PeripheralRole): PeripheralProfile => ({transport: role === 'printer' ? 'browser' : 'keyboard', autoReconnect: true, name: '', deviceId: '', baudRate: 9600, serviceUuid: '', characteristicUuid: '', host: '', port: role === 'printer' ? 9100 : 2000});
function safeProfile(value: unknown, role: PeripheralRole): PeripheralProfile {
  const fallback = profileDefault(role);
  if (!value || typeof value !== 'object') return fallback;
  const row = value as Partial<PeripheralProfile>;
  const text = (item: unknown, length = 253) => typeof item === 'string' ? item.slice(0, length) : '';
  const transports = role === 'printer' ? ['browser', 'usb', 'serial', 'bluetooth', 'lan'] : ['keyboard', 'serial', 'bluetooth', 'lan'];
  return {...fallback, transport: transports.includes(row.transport || '') ? row.transport! : fallback.transport,
    autoReconnect: row.autoReconnect !== false, name: text(row.name, 240), deviceId: text(row.deviceId, 240),
    vendorId: Number.isInteger(row.vendorId) && row.vendorId! >= 0 && row.vendorId! <= 65535 ? row.vendorId : undefined,
    productId: Number.isInteger(row.productId) && row.productId! >= 0 && row.productId! <= 65535 ? row.productId : undefined,
    serialNumber: text(row.serialNumber, 240), bluetoothServiceClassId: text(row.bluetoothServiceClassId, 120),
    baudRate: Number.isInteger(row.baudRate) && row.baudRate! >= 300 && row.baudRate! <= 921600 ? row.baudRate! : 9600,
    serviceUuid: text(row.serviceUuid, 80).trim().toLowerCase(), characteristicUuid: text(row.characteristicUuid, 80).trim().toLowerCase(),
    host: text(row.host).trim(), port: Number.isInteger(row.port) && row.port! > 0 && row.port! <= 65535 ? row.port! : fallback.port};
}
export function loadHardwarePreference(branchId: string): HardwarePreference {
  let value: Partial<HardwarePreference> = {};
  try {value = JSON.parse(localStorage.getItem(`retail-hardware-${branchId}`) || '{}') || {};} catch {/* A new profile can still be connected. */}
  const newClientId = () => globalThis.crypto?.randomUUID?.() || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {version: 1, clientId: typeof value.clientId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value.clientId) ? value.clientId : newClientId(), printer: safeProfile(value.printer, 'printer'), scanner: safeProfile(value.scanner, 'scanner')};
}
export function saveHardwarePreference(branchId: string, preference: HardwarePreference) {
  localStorage.setItem(`retail-hardware-${branchId}`, JSON.stringify({...preference, version: 1, printer: safeProfile(preference.printer, 'printer'), scanner: safeProfile(preference.scanner, 'scanner')}));
}
export function validateBluetoothUuid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(normalized)) return `0000${normalized}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) return normalized;
  throw new Error('Enter the 4-digit or full Bluetooth UUID from the device manual.');
}

/** Serial/BLE/LAN scanner mode supports printable UTF-8 codes terminated by CR or LF. */
export function createScannerLineDecoder(receive: (value: string) => void) {
  const decoder = new TextDecoder();
  let pending = '';
  let discarding = false;
  return (chunk: Uint8Array) => {
    for (const char of decoder.decode(chunk, {stream: true})) {
      if (char === '\r' || char === '\n') {
        const value = pending.trim(); pending = '';
        if (!discarding && value && !/[\u0000-\u001f\u007f]/.test(value)) receive(value);
        discarding = false;
      } else if (!discarding) {
        pending += char;
        if (pending.length > 256) {pending = ''; discarding = true;}
      }
    }
  };
}

/** Text-only ESC/POS. Control bytes in user data cannot become printer commands. */
export function escPosText(text: string) {
  if (!text.trim() || text.length > 16000) throw new Error('Receipt text must contain between 1 and 16,000 characters.');
  const printable = text.replace(/\r\n?/g, '\n').replace(/[^\x20-\x7e\n]/g, '?');
  return new Uint8Array([0x1b, 0x40, ...new TextEncoder().encode(printable), 10, 10, 10, 0x1d, 0x56, 0x42, 0]);
}

interface SerialPortLike extends EventTarget {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): {usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string};
  open(options: {baudRate: number}): Promise<void>;
  close(): Promise<void>;
}
interface SerialManagerLike extends EventTarget {getPorts(): Promise<SerialPortLike[]>; requestPort(): Promise<SerialPortLike>}
interface USBEndpointLike {endpointNumber: number; direction: 'in' | 'out'; type: string}
interface USBAlternateLike {alternateSetting: number; interfaceClass: number; endpoints: USBEndpointLike[]}
interface USBInterfaceLike {interfaceNumber: number; alternate: USBAlternateLike; alternates: USBAlternateLike[]}
interface USBDeviceLike extends EventTarget {
  vendorId: number; productId: number; serialNumber?: string; productName?: string; opened: boolean;
  configuration: {interfaces: USBInterfaceLike[]} | null;
  configurations: {configurationValue: number}[];
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>; releaseInterface(value: number): Promise<void>; selectAlternateInterface(value: number, alternate: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<{status: string; bytesWritten: number}>;
}
interface USBManagerLike extends EventTarget {getDevices(): Promise<USBDeviceLike[]>; requestDevice(options: {filters: object[]}): Promise<USBDeviceLike>}
interface BluetoothCharacteristicLike extends EventTarget {
  value?: DataView;
  properties: {write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean};
  startNotifications(): Promise<unknown>; stopNotifications(): Promise<unknown>;
  writeValueWithResponse(value: Uint8Array): Promise<void>; writeValueWithoutResponse(value: Uint8Array): Promise<void>;
}
interface BluetoothDeviceLike extends EventTarget {
  id: string; name?: string;
  gatt?: {connected: boolean; connect(): Promise<{getPrimaryService(uuid: string): Promise<{getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>}>}>; disconnect(): void};
}
interface BluetoothManagerLike {getDevices?: () => Promise<BluetoothDeviceLike[]>; requestDevice(options: {filters: {services: string[]}[]; optionalServices: string[]}): Promise<BluetoothDeviceLike>}
type PeripheralNavigator = Navigator & {serial?: SerialManagerLike; usb?: USBManagerLike; bluetooth?: BluetoothManagerLike};
export function peripheralCapabilities() {
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const nav = typeof navigator === 'undefined' ? null : navigator as PeripheralNavigator;
  return {secure, usb: !!(secure && nav?.usb), serial: !!(secure && nav?.serial), bluetooth: !!(secure && nav?.bluetooth)};
}
interface LiveChannel {
  transport: PeripheralTransport;
  write?: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}
const disconnectedStatus = (role: PeripheralRole, profile: PeripheralProfile): PeripheralStatus => ({state: profile.transport === 'browser' || profile.transport === 'keyboard' ? 'unknown' : 'disconnected', message: profile.transport === 'browser' ? 'Browser print dialog; physical connection is not observable.' : profile.transport === 'keyboard' ? 'USB / Bluetooth keyboard mode. Scan in the POS; physical connection is not observable.' : `No ${role} channel open.`, name: profile.name});
class PeripheralController {
  preference: HardwarePreference;
  status: HardwareStatus;
  private listeners = new Set<() => void>();
  private channels: Partial<Record<PeripheralRole, LiveChannel>> = {};
  private pending = new Set<PeripheralRole>();
  private closing = new Set<PeripheralRole>();
  private connectionVersion = {printer: 0, scanner: 0};
  private running = 0;
  private timer?: ReturnType<typeof setInterval>;
  private connecting?: Promise<void>;
  private generation = 0;
  private wakeCleanup?: () => void;
  private hubPollBusy = false;
  private scannerCursor = 0;
  private scannerSession = '';
  private reconnectAttempts = {printer: 0, scanner: 0};
  constructor(readonly branchId: string) {
    this.preference = loadHardwarePreference(branchId);
    this.status = {printer: disconnectedStatus('printer', this.preference.printer), scanner: disconnectedStatus('scanner', this.preference.scanner), lastScan: null};
  }
  subscribe = (callback: () => void) => {this.listeners.add(callback); return () => {this.listeners.delete(callback);};};
  snapshot = () => this.status;
  private update(role: PeripheralRole, state: PeripheralStatus['state'], message: string, name = this.preference[role].name) {
    this.status = {...this.status, [role]: {state, message, name}};
    this.listeners.forEach(listener => listener());
  }
  private scan(value: string, source: ScannerCode['source']) {
    const scan: ScannerCode = {value, source, receivedAt: new Date().toISOString()};
    this.status = {...this.status, lastScan: scan}; this.listeners.forEach(listener => listener());
    window.dispatchEvent(new CustomEvent<ScannerCode>(SCANNER_EVENT, {detail: scan}));
  }
  async configure(role: PeripheralRole, value: PeripheralProfile) {
    await this.disconnect(role, false);
    this.preference = {...this.preference, [role]: safeProfile(value, role)};
    saveHardwarePreference(this.branchId, this.preference);
    this.update(role, disconnectedStatus(role, this.preference[role]).state, disconnectedStatus(role, this.preference[role]).message);
  }
  async disconnect(role: PeripheralRole, disableReconnect = true) {
    this.connectionVersion[role]++;
    this.closing.add(role);
    if (disableReconnect) {this.preference = {...this.preference, [role]: {...this.preference[role], autoReconnect: false}}; saveHardwarePreference(this.branchId, this.preference);}
    const channel = this.channels[role]; delete this.channels[role];
    try {if (channel) await channel.close().catch(() => {});}
    finally {this.closing.delete(role); this.update(role, 'disconnected', 'Disconnected. Choose Connect to open the channel again.');}
  }
  async connect(role: PeripheralRole, choose = false) {
    if (this.pending.has(role) || this.closing.has(role) || this.channels[role]) return;
    const connectionVersion = this.connectionVersion[role];
    const profile = this.preference[role];
    if (['browser', 'keyboard'].includes(profile.transport)) {const status = disconnectedStatus(role, profile); this.update(role, status.state, status.message); return;}
    this.pending.add(role);
    this.update(role, 'connecting', choose ? 'Choose your device, then allow the connection.' : 'Reconnecting the saved device...');
    try {
      const transport = profile.transport;
      const nav = navigator as PeripheralNavigator;
      const caps = peripheralCapabilities();
      if (transport === 'serial') {
        if (!caps.serial || !nav.serial) throw new Error('Web Serial is unavailable. Use desktop Chrome / Edge over HTTPS or localhost, or keyboard scanner mode.');
        let port: SerialPortLike;
        if (choose) port = await nav.serial.requestPort();
        else {
          const ports = (await nav.serial.getPorts()).filter(item => {
            const info = item.getInfo();
            return profile.deviceId && info.usbVendorId === profile.vendorId && info.usbProductId === profile.productId && (info.bluetoothServiceClassId || '') === (profile.bluetoothServiceClassId || '');
          });
          if (ports.length !== 1) throw new Error(ports.length ? 'Several authorized serial devices match. Choose the correct device again.' : 'Saved serial device is unavailable. Connect it or choose a device again.');
          port = ports[0];
        }
        if (port.readable || port.writable) throw new Error('This serial port is already open in another channel.');
        await port.open({baudRate: profile.baudRate});
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let closing = false;
        let readFinished: Promise<void> = Promise.resolve();
        if (role === 'scanner') {
          const readable = port.readable as ReadableStream<Uint8Array> | null;
          if (!readable) {await port.close(); throw new Error('This serial device does not provide input.');}
          reader = readable.getReader();
          const feed = createScannerLineDecoder(value => this.scan(value, 'serial'));
          readFinished = (async () => {
            try {while (!closing) {const {value, done} = await reader!.read(); if (done) break; if (value) feed(value);}}
            catch {/* Disconnection becomes visible below. */}
            finally {reader!.releaseLock(); if (!closing) {delete this.channels[role]; void port.close().catch(() => {}); this.update(role, 'disconnected', 'Serial scanner disconnected. Waiting to reconnect.');}}
          })();
        }
        this.channels[role] = {transport, write: async bytes => {
          if (!port.writable) throw new Error('Serial printer has no writable channel.');
          const writer = port.writable.getWriter(); try {await writer.write(bytes);} finally {writer.releaseLock();}
        }, close: async () => {closing = true; if (reader) await reader.cancel().catch(() => {}); await readFinished; await port.close();}};
        const info = port.getInfo();
        this.remember(role, {...profile, name: info.usbVendorId !== undefined ? `Serial USB ${info.usbVendorId.toString(16)}:${(info.usbProductId || 0).toString(16)}` : 'Authorized serial device', deviceId: 'authorized-serial', vendorId: info.usbVendorId, productId: info.usbProductId, bluetoothServiceClassId: info.bluetoothServiceClassId || ''}, connectionVersion);
        const disconnected = (event: Event) => {if (event.target === port && this.channels[role]?.transport === 'serial') void this.disconnect(role, false);};
        port.addEventListener('disconnect', disconnected, {once: true});
      } else if (transport === 'usb') {
        if (role !== 'printer') throw new Error('Use keyboard mode or a serial port for USB scanners.');
        if (!caps.usb || !nav.usb) throw new Error('WebUSB is unavailable. Use desktop Chrome / Edge over HTTPS or localhost, or the browser print dialog.');
        const devices = choose ? [await nav.usb.requestDevice({filters: []})] : (await nav.usb.getDevices()).filter(item => item.vendorId === profile.vendorId && item.productId === profile.productId && (item.serialNumber || '') === (profile.serialNumber || ''));
        if (devices.length !== 1) throw new Error(devices.length ? 'Several identical USB printers match. Choose the printer again.' : 'Saved USB printer is unavailable. Reconnect it or choose it again.');
        const device = devices[0]; let interfaceNumber: number | undefined;
        try {
          if (!device.opened) await device.open();
          if (!device.configuration) await device.selectConfiguration(device.configurations[0]?.configurationValue || 1);
          const candidate = device.configuration?.interfaces.flatMap(item => item.alternates.map(alternate => ({item, alternate, endpoint: alternate.endpoints.find(endpoint => endpoint.direction === 'out' && endpoint.type === 'bulk')}))).find(item => item.endpoint && [7, 255].includes(item.alternate.interfaceClass));
          if (!candidate?.endpoint) throw new Error('No compatible printer bulk-output interface was found. Use the OS printer driver.');
          interfaceNumber = candidate.item.interfaceNumber;
          await device.claimInterface(interfaceNumber);
          if (candidate.item.alternate.alternateSetting !== candidate.alternate.alternateSetting) await device.selectAlternateInterface(interfaceNumber, candidate.alternate.alternateSetting);
          const endpoint = candidate.endpoint.endpointNumber;
          this.channels[role] = {transport, write: async bytes => {
            for (let offset = 0; offset < bytes.length; offset += 4096) {const chunk = bytes.slice(offset, offset + 4096); const result = await device.transferOut(endpoint, chunk); if (result.status !== 'ok' || result.bytesWritten !== chunk.length) throw new Error('The USB printer did not accept all receipt bytes.');}
          }, close: async () => {await device.releaseInterface(interfaceNumber!).catch(() => {}); await device.close();}};
          this.remember(role, {...profile, vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber || '', name: device.productName || 'USB receipt printer', deviceId: `${device.vendorId}:${device.productId}:${device.serialNumber || ''}`}, connectionVersion);
          const disconnected = (event: Event) => {if ((event as Event & {device?: USBDeviceLike}).device === device) {nav.usb!.removeEventListener('disconnect', disconnected); void this.disconnect(role, false);}};
          nav.usb.addEventListener('disconnect', disconnected);
          const original = this.channels[role]!.close;
          this.channels[role]!.close = async () => {nav.usb!.removeEventListener('disconnect', disconnected); await original();};
        } catch (error) {if (interfaceNumber !== undefined) await device.releaseInterface(interfaceNumber).catch(() => {}); await device.close().catch(() => {}); throw error;}
      } else if (transport === 'bluetooth') {
        if (!caps.bluetooth || !nav.bluetooth) throw new Error('Web Bluetooth is unavailable. Use a supporting browser or pair a keyboard / serial Bluetooth device in the operating system.');
        const serviceUuid = validateBluetoothUuid(profile.serviceUuid), characteristicUuid = validateBluetoothUuid(profile.characteristicUuid);
        const devices = choose ? [await nav.bluetooth.requestDevice({filters: [{services: [serviceUuid]}], optionalServices: [serviceUuid]})] : nav.bluetooth.getDevices ? (await nav.bluetooth.getDevices()).filter(item => item.id === profile.deviceId) : [];
        if (devices.length !== 1) throw new Error('Saved Bluetooth device is unavailable. Choose Connect to authorize it again.');
        const device = devices[0];
        let cleanupNotification: (() => void) | undefined;
        try {
          if (!device.gatt) throw new Error('This device does not provide a Bluetooth LE GATT channel.');
          const server = await device.gatt.connect();
          const service = await server.getPrimaryService(serviceUuid);
          const characteristic = await service.getCharacteristic(characteristicUuid);
          const feed = createScannerLineDecoder(value => this.scan(value, 'bluetooth'));
          const receive = () => {const value = characteristic.value; if (value) feed(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));};
          if (role === 'scanner') {
            if (!characteristic.properties.notify && !characteristic.properties.indicate) throw new Error('Scanner characteristic must support notifications. Check the device manual.');
            characteristic.addEventListener('characteristicvaluechanged', receive);
            cleanupNotification = () => characteristic.removeEventListener('characteristicvaluechanged', receive);
            await characteristic.startNotifications();
          } else if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) throw new Error('Printer characteristic must support writes. Check the device manual.');
          this.channels[role] = {transport, write: async bytes => {for (let offset = 0; offset < bytes.length; offset += 20) {const chunk = bytes.slice(offset, offset + 20); if (characteristic.properties.write) await characteristic.writeValueWithResponse(chunk); else await characteristic.writeValueWithoutResponse(chunk);}}, close: async () => {device.removeEventListener('gattserverdisconnected', disconnected); characteristic.removeEventListener('characteristicvaluechanged', receive); if (role === 'scanner') await characteristic.stopNotifications().catch(() => {}); device.gatt?.disconnect();}};
          const disconnected = () => {delete this.channels[role]; characteristic.removeEventListener('characteristicvaluechanged', receive); this.update(role, 'disconnected', 'Bluetooth device disconnected. Waiting to reconnect.');};
          device.addEventListener('gattserverdisconnected', disconnected, {once: true});
          this.remember(role, {...profile, serviceUuid, characteristicUuid, name: device.name || 'Bluetooth LE device', deviceId: device.id}, connectionVersion);
        } catch (error) {cleanupNotification?.(); device.gatt?.disconnect(); throw error;}
      } else if (transport === 'lan') {
        const {api} = await import('./api');
        const {isDeviceWorkspace} = await import('./workspace-mode');
        const {sharedCloudSource} = await import('./cloud-shared');
        if (isDeviceWorkspace() || sharedCloudSource()) throw new Error('LAN hardware requires a connected local branch hub. Select the branch-hub workspace to use it.');
        if (!profile.host.trim()) throw new Error('Enter the private LAN address and TCP port from the device manual.');
        if (role === 'printer') {
          const result = await api<{reachable: boolean; message: string}>('/devices/printer-check', {host: profile.host, port: profile.port});
          if (!result.reachable) throw new Error(result.message);
          this.channels[role] = {transport, write: async () => {}, close: async () => {}};
        } else {
          const result = await api<{sessionId: string}>('/devices/scanner/connect', {branchId: this.branchId, clientId: this.preference.clientId, host: profile.host, port: profile.port});
          if (result.sessionId !== this.scannerSession) {this.scannerSession = result.sessionId; this.scannerCursor = 0;}
          this.channels[role] = {transport, close: async () => {await api('/devices/scanner/disconnect', {branchId: this.branchId, clientId: this.preference.clientId});}};
        }
        this.remember(role, {...profile, deviceId: `${profile.host}:${profile.port}`, name: `${profile.host}:${profile.port}`}, connectionVersion);
      }
      if (connectionVersion !== this.connectionVersion[role]) {await this.disconnect(role, false); return;}
      this.reconnectAttempts[role] = 0;
      this.update(role, 'connected', role === 'scanner' ? 'Channel connected. CR / LF terminated scans add matching products in the POS.' : profile.transport === 'lan' ? 'TCP port responded. A test receipt verifies print output.' : 'Device channel connected. Print a test receipt to verify output.');
    } catch (error) {if (connectionVersion === this.connectionVersion[role]) this.update(role, 'disconnected', (error as Error).name === 'NotFoundError' ? 'No device was selected. Choose Connect to try again.' : (error as Error).message); if (choose) throw error;}
    finally {this.pending.delete(role);}
  }
  private remember(role: PeripheralRole, profile: PeripheralProfile, expectedVersion: number) {
    if (expectedVersion !== this.connectionVersion[role]) return;
    this.preference = {...this.preference, [role]: {...profile, autoReconnect: true}};
    try {saveHardwarePreference(this.branchId, this.preference);} catch {this.update(role, 'connected', 'Channel open; browser storage could not save reconnect settings.');}
  }
  private async tick() {
    if (!this.running || this.hubPollBusy) return;
    this.hubPollBusy = true;
    try {
      for (const role of ['printer', 'scanner'] as const) {
        const profile = this.preference[role];
        if (profile.autoReconnect && profile.deviceId && !this.channels[role] && !this.pending.has(role) && !this.closing.has(role)) {
          // Avoid repeated chooser prompts. Reconnect only previously authorized devices.
          this.reconnectAttempts[role]++;
          if (this.reconnectAttempts[role] % 5 === 1) await this.connect(role);
        }
      }
      if (this.channels.scanner?.transport === 'lan') {
        try {
          const {api} = await import('./api');
          const query = new URLSearchParams({branchId: this.branchId, clientId: this.preference.clientId, after: String(this.scannerCursor)});
          const result = await api<{connected: boolean; message: string; scans: {id: number; value: string}[]}>(`/devices/scanner/status?${query}`);
          if (!result.connected) {delete this.channels.scanner; this.update('scanner', 'disconnected', result.message);}
          for (const scan of result.scans) {if (scan.id > this.scannerCursor) {this.scan(scan.value, 'lan'); this.scannerCursor = scan.id;}}
        } catch (error) {delete this.channels.scanner; this.update('scanner', 'disconnected', (error as Error).message);}
      }
      if (this.channels.printer?.transport === 'lan' && ++this.printerTick >= 10) {
        this.printerTick = 0;
        const {api} = await import('./api'); const profile = this.preference.printer;
        try {const result = await api<{reachable: boolean; message: string}>('/devices/printer-check', {host: profile.host, port: profile.port}); if (!result.reachable) {delete this.channels.printer; this.update('printer', 'disconnected', result.message);}}
        catch (error) {delete this.channels.printer; this.update('printer', 'disconnected', (error as Error).message);}
      }
    } finally {this.hubPollBusy = false;}
  }
  private printerTick = 0;
  start() {
    this.running++;
    if (this.running === 1) {
      this.generation++;
      this.timer = setInterval(() => {void this.tick();}, 1000);
      const wake = () => {this.reconnectAttempts = {printer: 0, scanner: 0}; void this.tick();};
      window.addEventListener('online', wake); window.addEventListener('focus', wake);
      const nav = navigator as PeripheralNavigator;
      nav.usb?.addEventListener('connect', wake); nav.serial?.addEventListener('connect', wake);
      this.wakeCleanup = () => {window.removeEventListener('online', wake); window.removeEventListener('focus', wake); nav.usb?.removeEventListener('connect', wake); nav.serial?.removeEventListener('connect', wake);};
      this.connecting = this.tick();
    }
    let released = false;
    return () => {
      if (released) return; released = true; this.running--;
      if (!this.running) {
        if (this.timer) clearInterval(this.timer);
        this.wakeCleanup?.(); this.wakeCleanup = undefined;
        const generation = ++this.generation;
        // StrictMode remounts synchronously. Keep one channel across that remount.
        queueMicrotask(() => {if (!this.running && this.generation === generation) {void this.connecting?.finally(() => {if (!this.running) {void this.disconnect('printer', false); void this.disconnect('scanner', false);}});}});
      }
    };
  }
  async print(text: string) {
    const profile = this.preference.printer;
    if (profile.transport === 'browser') return false;
    const data = escPosText(text);
    if (profile.transport === 'lan') {
      const {api} = await import('./api');
      await api('/devices/raw-print', {branchId: this.branchId, host: profile.host, port: profile.port, text});
      this.update('printer', 'connected', 'Receipt bytes accepted by the TCP connection. Verify the paper output.');
      return true;
    }
    if (!this.channels.printer) await this.connect('printer');
    const channel = this.channels.printer;
    if (!channel?.write) throw new Error(this.status.printer.message || 'Connect your printer in Settings first.');
    try {await channel.write(data); return true;}
    catch (error) {await this.disconnect('printer', false); throw error;}
  }
}
const controllers = new Map<string, PeripheralController>();
export function peripheralController(branchId: string) {
  let controller = controllers.get(branchId);
  if (!controller) {controller = new PeripheralController(branchId); controllers.set(branchId, controller);}
  return controller;
}
export function startPeripheralConnections(branchId: string) {return peripheralController(branchId).start();}
export function printPeripheralText(branchId: string, text: string) {return peripheralController(branchId).print(text);}
