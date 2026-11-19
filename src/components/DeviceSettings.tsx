import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Bluetooth, Check, CircleHelp, Printer, RefreshCw, ScanBarcode, Unplug, Usb, Wifi} from 'lucide-react';
import type {PrinterDiscovery} from '../../shared/types';
import {usePOS} from '../lib/context';
import {isDeviceWorkspace} from '../lib/workspace-mode';
import {sharedCloudSource} from '../lib/cloud-shared';
import {classifyScannerInput, loadPrinterPreference, peripheralCapabilities, peripheralController, printPeripheralText, savePrinterPreference, type PeripheralProfile, type PeripheralRole, type PeripheralTransport, type ScannerInputResult} from '../lib/peripherals';
import {printTestReceipt} from '../lib/receipt';
import '../styles/devices.css';

const modes: Record<PeripheralRole, {value: PeripheralTransport; label: string}[]> = {
  printer: [{value: 'browser', label: 'OS printer / browser dialog (USB, Bluetooth or LAN)'}, {value: 'usb', label: 'USB direct - ESC/POS printer (WebUSB)'}, {value: 'serial', label: 'USB / Bluetooth serial - ESC/POS printer'}, {value: 'bluetooth', label: 'Bluetooth LE - ESC/POS GATT printer'}, {value: 'lan', label: 'LAN / Wi-Fi - raw TCP printer through branch hub'}],
  scanner: [{value: 'keyboard', label: 'USB / Bluetooth keyboard scanner (recommended)'}, {value: 'serial', label: 'USB / Bluetooth serial scanner'}, {value: 'bluetooth', label: 'Bluetooth LE - GATT scanner'}, {value: 'lan', label: 'LAN / Wi-Fi - TCP scanner through branch hub'}],
};
const clock = (date: string) => new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Colombo'}).format(new Date(date));

export default function DeviceSettings() {
  const {data, branchId, mutate, notify} = usePOS();
  const controller = useMemo(() => peripheralController(branchId), [branchId]);
  const status = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [drafts, setDrafts] = useState(() => ({printer: {...controller.preference.printer}, scanner: {...controller.preference.scanner}}));
  const [busy, setBusy] = useState<PeripheralRole | null>(null);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState<PrinterDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [savedPrinter, setSavedPrinter] = useState(() => loadPrinterPreference(branchId));
  const [scanText, setScanText] = useState('');
  const [testScan, setTestScan] = useState<ScannerInputResult | null>(null);
  const timing = useRef({started: 0, count: 0, pasted: false});
  const caps = peripheralCapabilities();
  const canUseHub = !isDeviceWorkspace() && !sharedCloudSource() && ['owner', 'manager', 'cashier'].includes(data.user.role);

  useEffect(() => {setDrafts({printer: {...controller.preference.printer}, scanner: {...controller.preference.scanner}}); setSavedPrinter(loadPrinterPreference(branchId)); setDiscovery(null); setError('');}, [controller, branchId]);
  const refreshQueues = useCallback(async () => {
    if (!canUseHub) return;
    setDiscovering(true);
    try {setDiscovery(await mutate<PrinterDiscovery>('/devices/printers', undefined, 'GET'));}
    catch (cause) {setError((cause as Error).message);}
    finally {setDiscovering(false);}
  }, [canUseHub, mutate]);
  useEffect(() => {void refreshQueues();}, [refreshQueues]);

  function update(role: PeripheralRole, changes: Partial<PeripheralProfile>) {
    setDrafts(current => ({...current, [role]: {...current[role], ...changes}})); setError('');
  }
  async function save(role: PeripheralRole) {
    setBusy(role); setError('');
    try {
      const previous = controller.preference[role], draft = drafts[role];
      const identityChanged = draft.transport !== previous.transport || draft.serviceUuid !== previous.serviceUuid || draft.characteristicUuid !== previous.characteristicUuid || draft.host !== previous.host || draft.port !== previous.port;
      await controller.configure(role, {...draft, ...(identityChanged ? {deviceId: '', name: '', vendorId: undefined, productId: undefined, serialNumber: '', bluetoothServiceClassId: ''} : {})});
      setDrafts(current => ({...current, [role]: {...controller.preference[role]}}));
      notify(`${role === 'printer' ? 'Printer' : 'Scanner'} setup saved on this device.`);
    } catch (cause) {setError((cause as Error).message);}
    finally {setBusy(null);}
  }
  async function connect(role: PeripheralRole) {
    setBusy(role); setError('');
    try {await controller.connect(role, true);}
    catch (cause) {setError((cause as Error).message);}
    finally {setDrafts(current => ({...current, [role]: {...controller.preference[role]}})); setBusy(null);}
  }
  async function disconnect(role: PeripheralRole) {
    setBusy(role); setError('');
    try {await controller.disconnect(role); setDrafts(current => ({...current, [role]: {...controller.preference[role]}}));}
    catch (cause) {setError((cause as Error).message);}
    finally {setBusy(null);}
  }
  async function testPrinter() {
    setPrinting(true); setError('');
    try {
      const text = [data.settings.businessName, 'PRINTER CONNECTION TEST', 'NOT A SALE', '--------------------------------', 'Left                         Right', 'Sample item x 2           1,200.00', '--------------------------------', 'Check paper, alignment and cutter.', new Date().toLocaleString('en-GB'), data.settings.receiptFooter].join('\n');
      if (await printPeripheralText(branchId, text)) notify('Test receipt sent. Check the printer output.'); else printTestReceipt(data.settings);
    } catch (cause) {setError((cause as Error).message);}
    finally {setPrinting(false);}
  }
  function receiveTest() {
    try {setTestScan(classifyScannerInput(scanText, timing.current.started ? performance.now() - timing.current.started : null, timing.current.count, timing.current.pasted)); setScanText(''); setError('');}
    catch (cause) {setError((cause as Error).message);}
    timing.current = {started: 0, count: 0, pasted: false};
  }

  return <section className="device-settings" aria-label="Printers and scanners">
    <div className="device-section-heading"><div><span className="management-eyebrow">COUNTER EQUIPMENT</span><h2>Printers & scanners</h2><p>Connect equipment, save its setup and reconnect when the app opens.</p></div><Printer size={21}/></div>
    {error && <div className="device-error" role="alert">{error}</div>}
    {(['printer', 'scanner'] as const).map(role => {
      const draft = drafts[role], live = status[role];
      const dirty = JSON.stringify(draft) !== JSON.stringify(controller.preference[role]);
      const direct = !['browser', 'keyboard'].includes(draft.transport);
      const unsupported = draft.transport === 'usb' && !caps.usb || draft.transport === 'serial' && !caps.serial || draft.transport === 'bluetooth' && !caps.bluetooth || draft.transport === 'lan' && !canUseHub;
      return <section className="panel device-card" key={role} aria-label={`${role} connection`}>
        <div className="device-card-heading"><div className="device-icon">{role === 'printer' ? <Printer size={20}/> : <ScanBarcode size={20}/>}</div><div><h3>{role === 'printer' ? 'Receipt printer' : 'Barcode scanner'}</h3><p>{role === 'printer' ? 'Choose how receipts reach this counter printer.' : 'Scans add matching products to the cart while the POS is open.'}</p></div><span className={`device-status ${live.state === 'connected' ? 'ready' : live.state === 'disconnected' ? 'offline' : 'unknown'}`} role="status"><span className="device-status-dot" aria-hidden="true"/>{live.state === 'connected' ? 'Channel connected' : live.state === 'disconnected' ? 'Disconnected' : live.state === 'connecting' ? 'Connecting...' : 'Connection unverified'}</span></div>
        <div className="hardware-profile-grid">
          <label className="field hardware-transport"><span>Connection method</span><select className="input" value={draft.transport} disabled={busy === role} onChange={event => update(role, {transport: event.target.value as PeripheralTransport})}>{modes[role].map(mode => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></label>
          {draft.transport === 'serial' && <label className="field"><span>Serial baud rate (device manual)</span><select className="input" value={draft.baudRate} onChange={event => update(role, {baudRate: Number(event.target.value)})}>{[9600, 19200, 38400, 57600, 115200].map(value => <option key={value}>{value}</option>)}</select></label>}
          {draft.transport === 'bluetooth' && <><label className="field"><span>GATT service UUID</span><input className="input" value={draft.serviceUuid} maxLength={80} onChange={event => update(role, {serviceUuid: event.target.value})} placeholder="UUID from the device manual" spellCheck={false}/></label><label className="field"><span>{role === 'printer' ? 'Write' : 'Notify'} characteristic UUID</span><input className="input" value={draft.characteristicUuid} maxLength={80} onChange={event => update(role, {characteristicUuid: event.target.value})} placeholder="4-digit or full UUID" spellCheck={false}/></label></>}
          {draft.transport === 'lan' && <><label className="field"><span>Private LAN address</span><input className="input" value={draft.host} maxLength={253} placeholder="192.168.1.90" spellCheck={false} autoComplete="off" onChange={event => update(role, {host: event.target.value})}/></label><label className="field"><span>TCP port</span><input className="input" type="number" min="1" max="65535" value={draft.port} onChange={event => update(role, {port: Number(event.target.value)})}/></label></>}
        </div>
        {direct && <label className="hardware-reconnect"><input type="checkbox" checked={draft.autoReconnect} onChange={event => update(role, {autoReconnect: event.target.checked})}/><span>Reconnect this saved device when the app opens</span></label>}
        <div className="device-usb-actions hardware-actions">
          {dirty && <button className="button button-primary" disabled={busy === role} onClick={() => void save(role)}><Check size={14}/> Save setup</button>}
          {direct && <button className="button button-ghost" disabled={dirty || busy !== null || live.state === 'connected' || unsupported} onClick={() => void connect(role)}>{draft.transport === 'bluetooth' ? <Bluetooth size={14}/> : draft.transport === 'lan' ? <Wifi size={14}/> : <Usb size={14}/>} {busy === role || live.state === 'connecting' ? 'Connecting...' : draft.transport === 'lan' ? 'Connect to address' : 'Choose & connect'}</button>}
          {direct && live.state === 'connected' && <button className="button button-ghost" disabled={busy !== null} onClick={() => void disconnect(role)}><Unplug size={14}/> Disconnect</button>}
          {role === 'printer' && <button className="button button-ghost" disabled={dirty || printing} onClick={() => void testPrinter()}><Printer size={14}/>{printing ? 'Sending...' : 'Print test receipt'}</button>}
          {dirty && <small className="device-note">Save setup before connecting or printing.</small>}
        </div>
        {live.name && <p className="device-note"><strong>Saved device:</strong> {live.name}</p>}
        <p className="device-note" role="status">{live.message}</p>
        {unsupported && <p className="device-error">{draft.transport === 'lan' ? 'LAN hardware needs the local branch-hub workspace. Browsers cannot open arbitrary TCP connections.' : 'This device API is unavailable here. Use a supporting desktop Chrome / Edge browser over HTTPS or localhost, or choose the OS / keyboard connection method.'}</p>}
        {draft.transport === 'browser' && <p className="device-note">Install or pair the printer in your operating system, then select it in the print dialog. The browser cannot detect its physical connection or silently choose an OS printer.</p>}
        {draft.transport === 'usb' && <p className="device-note">Requires an ESC/POS USB printer with an accessible bulk-output interface. An OS driver may own the interface; use the browser print dialog if direct access is blocked.</p>}
        {draft.transport === 'serial' && <p className="device-note">Put the device in serial / COM mode. Bluetooth Classic serial devices must be paired in the operating system first. {role === 'scanner' ? 'Use printable UTF-8 barcode output with a CR or LF suffix.' : 'Use an ESC/POS compatible printer; serial speed must match its configuration.'}</p>}
        {draft.transport === 'bluetooth' && <p className="device-note">Bluetooth LE only. Enter the device manufacturer's documented GATT UUIDs. {role === 'scanner' ? 'Notifications must contain printable UTF-8 codes with a CR or LF suffix.' : 'The write characteristic must accept ESC/POS bytes.'} OS Bluetooth keyboard devices use keyboard mode instead. Automatic reconnection depends on retained browser permission and browser support.</p>}
        {draft.transport === 'lan' && <p className="device-note">The local hub opens a TCP connection to this private LAN device. {role === 'scanner' ? 'The scanner must provide a TCP server that sends printable UTF-8 codes ending in CR or LF. No HTTP, UDP or vendor-specific binary decoding.' : 'Use the raw ESC/POS port (usually 9100). A green indicator means the TCP port responded; verify paper output with a test receipt.'}</p>}
        {draft.transport === 'keyboard' && <p className="device-note">Connect the scanner by USB or pair it in OS Bluetooth settings. Configure keyboard / HID mode and an Enter suffix. Scan while the POS page is open. The browser can observe scans but cannot detect a keyboard scanner being unplugged.</p>}
      </section>;
    })}
    {canUseHub && <section className="panel device-card"><div className="device-card-heading"><div className="device-icon"><Printer size={20}/></div><div><h3>Installed printers on the branch hub</h3><p>Operating system queue status, separate from direct device channels.</p></div><button className="button button-ghost button-small" disabled={discovering} onClick={() => void refreshQueues()}><RefreshCw size={14} className={discovering ? 'spin' : ''}/>{discovering ? 'Checking...' : 'Refresh'}</button></div>{discovery && <><p className="device-note">{discovery.message}</p><div className="device-printer-list">{discovery.printers.map(printer => <div className={`device-printer ${savedPrinter.selectedPrinterId === printer.id ? 'selected' : ''}`} key={printer.id}><div className="device-printer-top"><div><strong>{printer.name}</strong><span>{printer.driver} {printer.portName}</span></div><span className={`device-status ${printer.reportedStatus === 'offline' ? 'offline' : 'unknown'}`}><CircleHelp size={12}/>{printer.reportedStatus === 'ready' ? 'OS reports ready' : printer.reportedStatus === 'offline' ? 'OS reports offline' : 'Status unknown'}</span></div><div className="device-printer-bottom"><small>{printer.isDefault ? 'System default' : printer.statusDetail}</small><button className="button button-ghost button-small" onClick={() => {const value = {...savedPrinter, selectedPrinterId: printer.id, selectedPrinterName: printer.name}; try {savePrinterPreference(branchId, value); setSavedPrinter(value);} catch {setError('Could not save this printer preference.');}}}>{savedPrinter.selectedPrinterId === printer.id ? 'Saved preference' : 'Save preference'}</button></div></div>)}</div>{!discovery.printers.length && <p className="device-note">No installed printer queues found.</p>}</>}<p className="device-note">A saved queue name is a reminder. Choose that printer in the browser print dialog when using the OS route.</p></section>}
    <section className="panel device-card"><div className="device-card-heading"><div className="device-icon"><ScanBarcode size={20}/></div><div><h3>Scanner input test</h3><p>Test keyboard mode here. Serial, Bluetooth LE and LAN scans appear below automatically.</p></div></div><label className="field device-scan-field"><span>Keyboard scanner test - scan with an Enter suffix</span><input className="input" data-scanner-test="true" value={scanText} onChange={event => setScanText(event.target.value)} maxLength={256} placeholder="Focus here, then scan a barcode" autoComplete="off" spellCheck={false} onPaste={() => {timing.current.pasted = true;}} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); receiveTest();} else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {if (!timing.current.started) timing.current.started = performance.now(); timing.current.count++;}}}/></label>{testScan && <div className="device-report" role="status"><strong>{testScan.scannerLike ? 'Rapid scanner-style input received' : 'Input received'}: {testScan.value}</strong><small>{clock(testScan.receivedAt)}{testScan.elapsedMs !== null ? ` · ${testScan.elapsedMs} ms` : ''}. Input timing does not prove a physical connection.</small></div>}{status.lastScan && <div className="device-report" role="status"><strong>Device scan: {status.lastScan.value}</strong><small>{status.lastScan.source} · {clock(status.lastScan.receivedAt)}</small></div>}</section>
  </section>;
}
