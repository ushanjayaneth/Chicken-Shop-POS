import {registerSW} from 'virtual:pwa-register';

export const appUpdateReadyEvent = 'app-update-ready';

/** Prepare the offline shell as soon as the app opens, including the PIN screen. */
export const applyAppUpdate = registerSW({
  immediate: true,
  onNeedRefresh() { window.dispatchEvent(new Event(appUpdateReadyEvent)); },
  onRegisteredSW(_url, registration) {
    if (registration?.waiting) window.dispatchEvent(new Event(appUpdateReadyEvent));
  },
  // The register checks for saved drafts before reloading after a worker activates.
  onNeedReload() {},
});
