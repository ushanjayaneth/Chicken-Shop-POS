import {useState, useSyncExternalStore} from 'react';
import {Check, Download, Smartphone} from 'lucide-react';
import {Modal} from './ui';

interface BrowserInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

const changed = 'app-install-status';
const display = window.matchMedia('(display-mode: standalone)');
let pending: BrowserInstallPrompt | null = null;
let installed = false;

function publish() {
  window.dispatchEvent(new Event(changed));
}

window.addEventListener('beforeinstallprompt', event => {
  const prompt = event as BrowserInstallPrompt;
  if (typeof prompt.prompt !== 'function') return;
  pending = prompt;
});
window.addEventListener('appinstalled', () => {
  installed = true;
  pending = null;
  publish();
});

function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  display.addEventListener('change', listener);
  return () => {
    window.removeEventListener(changed, listener);
    display.removeEventListener('change', listener);
  };
}

function isInstalled() {
  return installed || display.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
}

function installInstructions() {
  const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (appleMobile) return 'Open this page in Safari. Tap Share, choose Add to Home Screen, then tap Add.';
  if (/Android/i.test(navigator.userAgent)) return 'Open this page in Chrome. Tap the ⋮ menu and choose Install app or Add to Home screen.';
  return 'Open this page in Chrome or Edge. Use the install icon in the address bar or choose Install app from the browser menu.';
}

export function InstallAppButton({className = 'button button-small'}: {className?: string} = {}) {
  const isAppInstalled = useSyncExternalStore(subscribe, isInstalled);
  const [instructions, setInstructions] = useState(false);
  const [busy, setBusy] = useState(false);

  async function install() {
    const request = pending;
    if (!request) { setInstructions(true); return; }
    pending = null;
    setBusy(true);
    try {
      await request.prompt();
      if ((await request.userChoice).outcome === 'accepted') {
        installed = true;
        publish();
      }
    } catch {
      setInstructions(true);
    } finally {
      setBusy(false);
    }
  }

  if (isAppInstalled) return null;
  return <>
    <button type="button" className={className} title="Install app" aria-label="Install app" disabled={busy} onClick={() => void install()}>
      <Download size={15} /><span>{busy ? 'Installing…' : 'Install app'}</span>
    </button>
    {instructions && <Modal title="Install app" subtitle={installInstructions()} onClose={() => setInstructions(false)}>
      <div className="form-actions"><button type="button" className="button button-primary" onClick={() => setInstructions(false)}>Done</button></div>
    </Modal>}
  </>;
}

export function AppInstallSettings() {
  const isAppInstalled = useSyncExternalStore(subscribe, isInstalled);
  return <div className="storage-install">
    <Smartphone size={20} />
    <div>
      <strong>{isAppInstalled ? 'App installed' : 'Install on this device'}</strong>
      <p>{isAppInstalled ? 'Open Chicken House POS from your Home Screen or app list.' : 'Add Chicken House POS to your Home Screen or app list.'}</p>
    </div>
    {isAppInstalled ? <Check size={18} className="storage-positive" /> : <InstallAppButton />}
  </div>;
}
