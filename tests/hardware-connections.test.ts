import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScannerLineDecoder, escPosText, loadHardwarePreference, peripheralController, printPeripheralText, saveHardwarePreference, SCANNER_EVENT, startPeripheralConnections, validateBluetoothUuid} from '../src/lib/peripherals';
import {resolveHardwareTarget, NetworkScanners} from '../server/hardware';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => memory.set(key, value)}});
const testWindow = Object.assign(new EventTarget(), {isSecureContext: true});
Object.defineProperty(globalThis, 'window', {configurable: true, value: testWindow});
const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', {configurable: true, value});
async function eventually(predicate: () => boolean) {for (let attempt = 0; attempt < 100; attempt++) {if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5));} assert.fail('Mock hardware operation did not complete.');}

test('line scanner decoder handles fragmented UTF-8, CRLF, invalid controls and overlong scans', () => {
  const values: string[] = [], feed = createScannerLineDecoder(value => values.push(value));
  feed(new TextEncoder().encode('0012')); feed(new TextEncoder().encode('34\r\nSECOND\n'));
  feed(new TextEncoder().encode(`${'x'.repeat(257)}\nBAD\u0000CODE\nGOOD\r`));
  assert.deepEqual(values, ['001234', 'SECOND', 'GOOD']);
  const unicode = new TextEncoder().encode('café\n'); feed(unicode.slice(0, 4)); feed(unicode.slice(4));
  assert.equal(values.at(-1), 'café');
});

test('raw ESC/POS receipts contain bounded text and neutralize injected control commands', () => {
  const bytes = escPosText('Invoice\r\n\u001bp\u0000drawer');
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
  assert.match(new TextDecoder().decode(bytes.slice(2, -7)), /Invoice\n\?p\?drawer/);
  assert.equal([...bytes].filter(byte => byte === 0x1b).length, 1);
  assert.throws(() => escPosText(''), /Receipt text/); assert.throws(() => escPosText('x'.repeat(16001)), /Receipt text/);
});

test('hardware setup validates UUIDs and restores only supported saved configuration', () => {
  assert.equal(validateBluetoothUuid(' FFE0 '), '0000ffe0-0000-1000-8000-00805f9b34fb');
  assert.throws(() => validateBluetoothUuid('serial-port'), /UUID/);
  memory.set('retail-hardware-corrupt', JSON.stringify({version: 0, clientId: '<bad>', printer: {transport: 'fake', port: 70000}, scanner: {transport: 'usb', baudRate: -4}}));
  const preference = loadHardwarePreference('corrupt');
  assert.equal(preference.printer.transport, 'browser'); assert.equal(preference.printer.port, 9100); assert.equal(preference.scanner.transport, 'keyboard'); assert.equal(preference.scanner.baudRate, 9600);
  saveHardwarePreference('roundtrip', preference); assert.equal(loadHardwarePreference('roundtrip').clientId, preference.clientId);
});

test('USB / Bluetooth keyboard modes remain unverified and browser printing explicitly requests fallback', async () => {
  setNavigator({}); const controller = peripheralController('keyboard');
  assert.equal(controller.snapshot().printer.state, 'unknown'); assert.equal(controller.snapshot().scanner.state, 'unknown');
  assert.equal(await printPeripheralText('keyboard', 'Test receipt'), false);
});

class MockSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  input?: ReadableStreamDefaultController<Uint8Array>;
  opens = 0; closes = 0;
  getInfo() {return {usbVendorId: 123, usbProductId: 456};}
  async open() {this.opens++; this.readable = new ReadableStream({start: controller => {this.input = controller;}}); this.writable = new WritableStream();}
  async close() {this.closes++; this.readable = null; this.writable = null;}
  scan(value: string) {this.input!.enqueue(new TextEncoder().encode(value));}
}

test('serial scanner emits complete codes and reconnects a saved authorized port without a new chooser', async () => {
  const port = new MockSerialPort(); let chooserCalls = 0;
  const serial = Object.assign(new EventTarget(), {getPorts: async () => [port], requestPort: async () => {chooserCalls++; return port;}});
  setNavigator({serial});
  const controller = peripheralController('serial-reopen'); const scans: string[] = [];
  const scan = (event: Event) => scans.push((event as CustomEvent).detail.value);
  testWindow.addEventListener(SCANNER_EVENT, scan);
  const stop = startPeripheralConnections('serial-reopen');
  await controller.configure('scanner', {...controller.preference.scanner, transport: 'serial'});
  await controller.connect('scanner', true);
  assert.equal(controller.snapshot().scanner.state, 'connected');
  port.scan('BAR'); port.scan('CODE\r\n'); await eventually(() => scans.length === 1); assert.deepEqual(scans, ['BARCODE']);
  stop(); await eventually(() => port.closes === 1);
  const stopAgain = startPeripheralConnections('serial-reopen');
  await eventually(() => port.opens === 2); assert.equal(chooserCalls, 1);
  port.scan('REOPEN\n'); await eventually(() => scans.length === 2); assert.equal(scans[1], 'REOPEN');
  await controller.disconnect('scanner'); assert.equal(controller.preference.scanner.autoReconnect, false);
  stopAgain(); testWindow.removeEventListener(SCANNER_EVENT, scan);
});

test('WebUSB printer claims a real bulk output interface, sends bytes, reports unplug and never silently falls back', async () => {
  const writes: Uint8Array[] = []; let requests = 0, released = 0;
  const device = Object.assign(new EventTarget(), {vendorId: 10, productId: 20, serialNumber: 'mock-1', productName: 'Mock printer', opened: false,
    configuration: {interfaces: [{interfaceNumber: 2, alternate: {alternateSetting: 0, interfaceClass: 7, endpoints: [{endpointNumber: 3, direction: 'out', type: 'bulk'}]}, alternates: [{alternateSetting: 0, interfaceClass: 7, endpoints: [{endpointNumber: 3, direction: 'out', type: 'bulk'}]}]}]}, configurations: [{configurationValue: 1}],
    open: async () => {device.opened = true;}, close: async () => {device.opened = false;}, selectConfiguration: async () => {}, claimInterface: async (value: number) => {assert.equal(value, 2);}, releaseInterface: async () => {released++;}, selectAlternateInterface: async () => {},
    transferOut: async (endpoint: number, bytes: Uint8Array) => {assert.equal(endpoint, 3); writes.push(bytes); return {status: 'ok', bytesWritten: bytes.length};}});
  const usb = Object.assign(new EventTarget(), {getDevices: async () => [device], requestDevice: async () => {requests++; return device;}});
  setNavigator({usb}); const controller = peripheralController('usb-print');
  await controller.configure('printer', {...controller.preference.printer, transport: 'usb'});
  await controller.connect('printer', true); assert.equal(controller.snapshot().printer.state, 'connected');
  assert.equal(await printPeripheralText('usb-print', 'Actual receipt'), true); assert.deepEqual(writes[0], escPosText('Actual receipt'));
  const unplug = Object.assign(new Event('disconnect'), {device}); usb.dispatchEvent(unplug);
  await eventually(() => controller.snapshot().printer.state === 'disconnected'); assert.equal(released, 1);
  await controller.connect('printer'); assert.equal(requests, 1);
  device.transferOut = async () => {throw new Error('Mock transfer failed');};
  await assert.rejects(() => printPeripheralText('usb-print', 'Receipt'), /Mock transfer failed/);
  assert.equal(controller.snapshot().printer.state, 'disconnected');
});

test('BLE scanner subscribes to documented notifications, decodes fragments, and detaches on disconnect', async () => {
  let notifications = 0, stops = 0;
  const characteristic = Object.assign(new EventTarget(), {value: undefined as DataView | undefined, properties: {write: false, writeWithoutResponse: false, notify: true, indicate: false}, startNotifications: async () => {notifications++;}, stopNotifications: async () => {stops++;}, writeValueWithResponse: async () => {}, writeValueWithoutResponse: async () => {}});
  const device = Object.assign(new EventTarget(), {id: 'mock-ble', name: 'Mock BLE scanner', gatt: {connected: false, connect: async () => {device.gatt.connected = true; return {getPrimaryService: async () => ({getCharacteristic: async () => characteristic})};}, disconnect: () => {device.gatt.connected = false;}}});
  setNavigator({bluetooth: {requestDevice: async () => device, getDevices: async () => [device]}});
  const controller = peripheralController('ble-scan');
  await controller.configure('scanner', {...controller.preference.scanner, transport: 'bluetooth', serviceUuid: 'ffe0', characteristicUuid: 'ffe1'});
  await controller.connect('scanner', true); assert.equal(notifications, 1); assert.equal(controller.snapshot().scanner.state, 'connected');
  const bytes = new TextEncoder().encode('BLE-CODE\n'); characteristic.value = new DataView(bytes.buffer); characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  assert.equal(controller.snapshot().lastScan?.value, 'BLE-CODE');
  await controller.disconnect('scanner'); assert.equal(stops, 1);
  characteristic.dispatchEvent(new Event('characteristicvaluechanged')); assert.equal(controller.snapshot().scanner.state, 'disconnected');
});

test('LAN hardware rejects non-LAN addresses before opening a socket and empty scanner status stays disconnected', async () => {
  for (const host of ['8.8.8.8', '127.0.0.1', '169.254.169.254', 'https://192.168.1.90', '192.168.1.90;whoami']) await assert.rejects(() => resolveHardwareTarget(host, 9100));
  assert.deepEqual(await resolveHardwareTarget('192.168.1.90', 9100), {host: '192.168.1.90', port: 9100, address: '192.168.1.90'});
  const scanners = new NetworkScanners(); assert.deepEqual(scanners.read('absent'), {connected: false, message: 'No LAN scanner channel is open.', scans: []}); scanners.close();
});
