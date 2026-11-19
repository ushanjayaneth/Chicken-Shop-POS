import Dexie from 'dexie';
import '@fontsource-variable/inter';
import {registerSW} from 'virtual:pwa-register';
import * as CoconutLedger from '../../shared/coconut/coconut-ledger.mjs';
import {applyCoconutCommand, buildCoconutCommand, ledgerCollections, validId} from '../../shared/coconut/workspace.mjs';
import {createLocalCredential, verifyLocalPin} from '../lib/local/auth';
import {CoconutMgr} from './manager.js';
import {open80mmPrintWindow} from './receipt.js';
import './workspace.css';

const db = new Dexie('chicken-house-coconut-v1');
db.version(1).stores({workspace: ''});
const el = id => document.getElementById(id);
const form = el('ccLogin');
const pinInput = el('ccPin');
const content = el('ccWorkspace');
const status = el('ccConnection');
const signOut = el('ccSignOut');
const S = {};
const load = () => db.workspace.get('current');
const save = state => db.workspace.put(state, 'current');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[char]);
let signedIn = false;
let syncing;
let toastTimer;

function setStatus(state, message) {
  status.dataset.state = state;
  status.textContent = message;
}
function toast(message) {
  const output = el('ccToast');
  output.textContent = message;
  output.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { output.hidden = true; }, 5000);
}
async function cloud(action, body) {
  const response = await fetch('/api/coconut?action=' + action, {
    method: body === undefined ? 'GET' : 'POST', credentials:'same-origin',
    headers: {'Content-Type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Coconut cloud is unavailable.'), {status:response.status});
  return result;
}
function workingSnapshot(state) {
  return state.pending.reduce((snapshot, command) => applyCoconutCommand(snapshot,command).snapshot, state.snapshot);
}
async function loadAll() {
  const state = await load();
  if (!signedIn || !state?.snapshot) return;
  const snapshot = workingSnapshot(state);
  S.settings = snapshot.settings.main;
  for (const name of ledgerCollections) {
    S[name] = Object.entries(snapshot[name] ?? {}).map(([id, row]) => ({...row, id}));
  }
  CoconutMgr.init();
  CoconutMgr.switchTab(CoconutMgr._tab);
}

async function sync() {
  if (!signedIn) return;
  if (!navigator.onLine) {
    const pending = (await load())?.pending.length ?? 0;
    setStatus('offline', pending ? 'Offline · ' + pending + ' saved entries waiting to sync' : 'Offline · saved data available');
    return;
  }
  try {
    let state = await load();
    while (signedIn && state?.pending.length) {
      const [head] = state.pending;
      const snapshot = await cloud('snapshot', head);
      await db.transaction('rw', db.workspace, async () => {
        const latest = await load();
        if (latest?.pending[0]?.id !== head.id) return;
        await save({...latest, snapshot, pending:latest.pending.slice(1)});
      });
      state = await load();
    }
    if (!signedIn) return;
    const snapshot = await cloud('snapshot');
    await db.transaction('rw', db.workspace, async () => {
      const latest = await load();
      if (!latest?.pending.length) await save({...latest, snapshot, pending:[]});
    });
    await loadAll();
    setStatus('online', 'Cloud connected');
  } catch (error) {
    if (!signedIn) return;
    const pending = (await load())?.pending.length ?? 0;
    setStatus('offline', error.status === 409 ? error.message
      : error.status === 401 ? 'Sign in again to sync saved entries'
      : pending ? 'Cloud unavailable · ' + pending + ' saved entries waiting to sync' : 'Cloud unavailable · showing saved data');
    if (error.status === 401) {
      form.hidden = false;
      pinInput.focus();
    }
  }
}
function syncCoconut() {
  if (syncing) return syncing;
  const task = () => sync();
  syncing = Promise.resolve(navigator.locks ? navigator.locks.request('chicken-coconut-sync', task) : task())
    .finally(() => { syncing = undefined; });
  return syncing;
}
const DB = {
  newId: () => crypto.randomUUID(),
  async batch(operations) {
    if (!signedIn) throw new Error('Sign in before saving an entry.');
    await db.transaction('rw', db.workspace, async () => {
      const state = await load(), snapshot = workingSnapshot(state);
      const command = buildCoconutCommand(snapshot, operations, this.newId());
      applyCoconutCommand(snapshot, command);
      await save({...state, pending:[...state.pending, command]});
    });
    void syncCoconut();
  },
};

Object.assign(window, {
  CoconutMgr, CoconutLedger, S, DB, loadAll, syncCoconut, toast, esc:escapeHtml,
  safeRecordId: id => validId(id) ? id : '',
  print80mmDoc: open80mmPrintWindow,
  localBusinessDate: (date = new Date()) => date.toLocaleDateString('en-CA', {timeZone:'Asia/Colombo'}),
  Modal: {
    open: id => el(id)?.classList.add('open'),
    close: id => el(id)?.classList.remove('open'),
  },
});
async function openWorkspace() {
  const state = await load();
  if (!state?.snapshot) throw new Error('Connect to the internet once to load the coconut workspace.');
  signedIn = true;
  form.hidden = true;
  content.hidden = false;
  signOut.hidden = false;
  await loadAll();
  void syncCoconut();
}
async function logIn(event) {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  const pin = pinInput.value;
  try {
    const state = await load();
    let verifiedOnline = false;
    if (navigator.onLine) {
      try {
        await cloud('pos-login', {pin});
        verifiedOnline = true;
      } catch (error) {
        if (error.status && error.status < 500) throw error;
      }
    }
    if (verifiedOnline) {
      const credential = await createLocalCredential('coconut', pin, 16);
      const snapshot = state?.pending.length ? state.snapshot : await cloud('snapshot');
      await db.transaction('rw', db.workspace, async () => {
        const latest = await load();
        await save({snapshot:latest?.pending.length ? latest.snapshot : snapshot, pending:latest?.pending ?? [],
          credential, trusted:true, signedOut:false, failures:0});
      });
      void navigator.storage?.persist?.().catch(() => {});
    } else {
      if (!state?.credential || !state.snapshot) throw new Error('Connect to the internet before signing in on this device.');
      if ((state.retryAfter ?? 0) > Date.now()) throw new Error('Too many PIN attempts. Try again in 15 minutes.');
      if (!await verifyLocalPin(pin, state.credential, 16)) {
        const failures = (state.failures ?? 0) + 1;
        await db.transaction('rw', db.workspace, async () => {
          const latest = await load();
          await save({...latest, failures:failures >= 8 ? 0 : failures, retryAfter:failures >= 8 ? Date.now() + 900000 : 0});
        });
        throw new Error('The Coconut PIN is incorrect.');
      }
      await db.transaction('rw', db.workspace, async () => {
        const latest = await load();
        await save({...latest, trusted:true, failures:0, retryAfter:0});
      });
    }
    await openWorkspace();
  } catch (error) {
    setStatus('offline', error.message);
  } finally {
    pinInput.value = '';
    button.disabled = false;
  }
}
async function boot() {
  try {
    const state = await load();
    if (state?.trusted && state.snapshot) return await openWorkspace();
    if (navigator.onLine && !state?.signedOut) {
      const session = await cloud('pos-session');
      if (session.authenticated) {
        const snapshot = state?.pending.length ? state.snapshot : await cloud('snapshot');
        await save({...state, snapshot, pending:state?.pending ?? [], trusted:true});
        return await openWorkspace();
      }
      setStatus('online', 'Cloud ready · sign in to continue');
    } else setStatus('offline', 'Sign in to open the workspace');
  } catch {
    setStatus('offline', 'Cloud unavailable · connect to sign in on a new device');
  }
  form.hidden = false;
}

form.addEventListener('submit', logIn);
signOut.addEventListener('click', async () => {
  signedIn = false;
  await db.transaction('rw', db.workspace, async () => {
    const state = await load();
    if (state) await save({...state, trusted:false, signedOut:true});
  });
  if (navigator.onLine) await cloud('pos-logout', {}).catch(() => {});
  location.reload();
});
document.querySelector('#coconutTab').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.target.type === 'date') return;
  const buttons = event.target.closest('.admin-section')?.querySelectorAll('button[onclick^="CoconutMgr.save"]');
  if (buttons?.length === 1) {
    event.preventDefault();
    buttons[0].click();
  }
});
window.addEventListener('online', () => void syncCoconut());
window.addEventListener('offline', () => void syncCoconut());
window.addEventListener('focus', () => void syncCoconut());
setInterval(() => { if (document.visibilityState === 'visible') void syncCoconut(); }, 15000);
if ('serviceWorker' in navigator) registerSW();
void boot();
