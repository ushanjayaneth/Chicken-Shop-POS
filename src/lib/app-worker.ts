export const appUpdateReadyEvent = 'app-update-ready';
const script = '/sw.js';
const workers = navigator.serviceWorker;
const registrations = new WeakSet<ServiceWorkerRegistration>();
let starting = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function retryPreparation() {
  if (!navigator.onLine || retryTimer !== undefined) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void prepareOfflineShell();
  }, 6000);
}

function track(registration: ServiceWorkerRegistration) {
  if (registration.waiting) window.dispatchEvent(new Event(appUpdateReadyEvent));
  if (registrations.has(registration)) return;
  registrations.add(registration);
  const observeInstall = () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (registration.waiting) window.dispatchEvent(new Event(appUpdateReadyEvent));
      if (worker.state === 'redundant' && !registration.active) retryPreparation();
    });
  };
  registration.addEventListener('updatefound', observeInstall);
  observeInstall();
}

async function prepareOfflineShell() {
  if (!workers || !navigator.onLine || starting) return;
  starting = true;
  try {
    const registration = await workers.getRegistration();
    if (registration?.active || registration?.waiting || registration?.installing) {
      track(registration);
      return;
    }
    track(await workers.register(script, {scope: '/', updateViaCache: 'none'}));
  } catch {
    if (!workers.controller) retryPreparation();
  } finally {
    starting = false;
  }
}

if (import.meta.env.PROD && workers) {
  void prepareOfflineShell();
  window.addEventListener('online', () => void prepareOfflineShell());
}

export async function applyAppUpdate() {
  const waiting = (await workers?.getRegistration())?.waiting;
  if (!waiting) throw new Error('The app update is not ready.');
  waiting.postMessage({type: 'SKIP_WAITING'});
}

export function subscribeOfflineShell(announce: () => void) {
  workers?.addEventListener('controllerchange', announce);
  return () => workers?.removeEventListener('controllerchange', announce);
}

export function offlineShellReady() {
  const controller = workers?.controller;
  return Boolean(controller && new URL(controller.scriptURL).pathname === script);
}
