/* Offline transactions and queued Firebase writes share one durable commit. */
const CacheTree = {
  roots: ['categories', 'items', 'sales', 'loan_customers', 'loans', 'coconut_purchases', 'coconut_husking', 'coconut_gradings', 'coconut_sales', 'coconut_copra', 'coconut_oil', 'coconut_workers', 'coconut_worker_payments', 'cash_movements', 'day_ends'],
  path(value) {
    if (typeof value !== 'string') throw new Error('A database path is required.');
    const parts = value.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.some(part => !part || /[.#$\[\]]/.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('The database path is invalid.');
    return parts;
  },
  clone(value) {return value === undefined ? null : JSON.parse(JSON.stringify(value));},
  get(root, parts) {return parts.reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, root) ?? null;},
  put(root, parts, value) {
    if (!parts.length) return this.clone(value);
    const result = root && typeof root === 'object' ? this.clone(root) : {};
    let parent = result;
    for (const part of parts.slice(0, -1)) {
      if (!parent[part] || typeof parent[part] !== 'object') parent[part] = {};
      parent = parent[part];
    }
    const key = parts[parts.length - 1];
    if (value === null) {if (Array.isArray(parent)) parent[key] = null; else delete parent[key];}
    else parent[key] = this.clone(value);
    return result;
  },
  update(updates, path, value) {
    const ancestor = Object.keys(updates).find(key => path.startsWith(key + '/'));
    if (ancestor) {updates[ancestor] = this.put(updates[ancestor], path.slice(ancestor.length + 1).split('/'), value);return;}
    for (const key of Object.keys(updates)) if (key.startsWith(path + '/')) delete updates[key];
    updates[path] = this.clone(value);
  },
  readRoot(store, root, done, fail) {
    const request = store.get(root);
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      if (request.result) {done(request.result.data);return;}
      const children = store.getAll(IDBKeyRange.bound(root + '/', root + '/\uffff'));
      children.onerror = () => fail(children.error);
      children.onsuccess = () => {
        let value = null;
        for (const row of children.result) value = this.put(value, row.path.slice(root.length + 1).split('/'), row.data);
        done(value);
      };
    };
  }
};

function localBusinessDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const part = type => parts.find(value => value.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const IDB = {
  _db: null,
  _opening: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(' CommPOS_DB', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', {keyPath: 'path'});
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', {keyPath: 'id', autoIncrement: true});
      };
      request.onsuccess = () => {
        this._db = request.result;
        this._db.onversionchange = () => {this._db.close();this._db = null;this._opening = null;};
        resolve(this._db);
      };
      request.onerror = () => {this._opening = null;reject(request.error);};
      request.onblocked = () => {this._opening = null;reject(new Error('Close other POS tabs, then reopen this screen.'));};
    });
    return this._opening;
  },
  async cacheGet(path) {
    const parts = CacheTree.path(path);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('cache');
      CacheTree.readRoot(transaction.objectStore('cache'), parts[0], root => resolve(CacheTree.get(root, parts.slice(1))), reject);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async commit(operations, enqueue = true) {
    if (!operations.length) return;
    const ops = operations.map(operation => {
      const parts = CacheTree.path(operation.path);
      if (!['set', 'patch', 'del'].includes(operation.type)) throw new Error('Unknown database operation.');
      if (operation.type === 'patch' && (!operation.data || Array.isArray(operation.data) || typeof operation.data !== 'object')) throw new Error('A database patch must contain fields.');
      return {...operation, parts, data: operation.type === 'del' ? null : CacheTree.clone(operation.data)};
    });
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cache', 'queue'], 'readwrite');
      const store = transaction.objectStore('cache');
      const roots = [...new Set(ops.map(op => op.parts[0]))];
      const values = new Map();
      let failure = null;
      const fail = error => {failure = error;try {transaction.abort();} catch {} };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(failure || transaction.error || new Error('The device could not save this transaction.'));
      transaction.onabort = () => reject(failure || transaction.error || new Error('The transaction was canceled before saving.'));
      for (const root of roots) CacheTree.readRoot(store, root, value => {
        values.set(root, value);
        if (values.size !== roots.length) return;
        try {
          const updates = {};
          const guards = [];
          for (const op of ops) {
            const root = op.parts[0];
            const relative = op.parts.slice(1);
            const current = CacheTree.get(values.get(root), relative);
            if (op.expected) guards.push({path:op.parts.join('/'),expected:CacheTree.clone(op.expected),before:CacheTree.clone(current)});
            if (op.expected) for (const [key, expected] of Object.entries(op.expected)) {
              const normalize = value => key === 'stockBatches' ? Object.values(value || {}).filter(Boolean) : value ?? (['paymentHistory','returnItems'].includes(key) ? [] : ['paidAmount','refundTotal'].includes(key) ? 0 : null);
              if (JSON.stringify(normalize(current?.[key])) !== JSON.stringify(normalize(expected))) throw new Error('This record changed on another screen. Refresh and review the transaction before trying again.');
            }
            if (op.type === 'patch') {
              let record = current;
              for (const [key, value] of Object.entries(op.data)) {
                const fields = CacheTree.path(key);
                record = CacheTree.put(record, fields, value);
                CacheTree.update(updates, op.parts.concat(fields).join('/'), value);
              }
              values.set(root, CacheTree.put(values.get(root), relative, record));
            } else {
              values.set(root, CacheTree.put(values.get(root), relative, op.data));
              CacheTree.update(updates, op.parts.join('/'), op.data);
            }
          }
          for (const [root, value] of values) store.put({path: root, data: value, ts: Date.now()});
          if (enqueue) transaction.objectStore('queue').add({type: 'batch', data: updates, guards, ts: Date.now(), commandId: DB.newId()});
        } catch (error) {fail(error);}
      }, fail);
    });
  },
  cacheSet(path, data) {return this.commit([{type: 'set', path, data}], false);},
  cacheSetWithParent(path, data) {return this.cacheSet(path, data);},
  cachePatch(path, data) {return this.commit([{type: 'patch', path, data}], false);},
  cacheDel(path) {return this.commit([{type: 'del', path}], false);},
  cachePush(path, data, id) {return this.cacheSet(path + '/' + id, data);},
  async queueGetAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('queue');
      const request = transaction.objectStore('queue').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async queueCount() {return (await this.queueGetAll()).length;},
  async queueDelete(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('queue', 'readwrite');
      transaction.objectStore('queue').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async queueAdd(operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('queue', 'readwrite');
      const request = transaction.objectStore('queue').add({...operation, ts: Date.now()});
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
};

const Sync = {
  _running: false,
  _flushPromise: null,
  _pullPromise: null,
  _started: false,
  async _lock(action) {
    if (navigator.locks?.request) return navigator.locks.request('chicken-pos-cloud-sync', action);
    const token = DB.newId();
    const lease = async release => {
      const db = await IDB.open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('cache', 'readwrite');
        const store = transaction.objectStore('cache');
        const request = store.get('__syncLease');
        let acquired = false;
        request.onsuccess = () => {
          const previous = request.result;
          if (release) {if (previous?.token === token) store.delete('__syncLease');return;}
          const now = Date.now();
          if (!previous || previous.token === token || previous.until <= now || previous.until > now + 60000) {
            store.put({path: '__syncLease', token, until: now + 30000});acquired = true;
          }
        };
        transaction.oncomplete = () => resolve(acquired);
        transaction.onerror = () => reject(transaction.error);
      });
    };
    if (!await lease(false)) return false;
    const heartbeat = setInterval(() => {void lease(false).catch(() => {});}, 8000);
    try {return await action();} finally {clearInterval(heartbeat);await lease(true);}
  },
  async _request(path, options = {}) {
    const response = await fetch(getApiUrl(path), {...options, signal: AbortSignal.timeout(15000)});
    if (!response.ok) {let data={};try{data=await response.json();}catch{}const error=new Error(data.error||`Cloud request failed with HTTP ${response.status}.`);error.status=response.status;error.code=data.code;throw error;}
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('The cloud API did not return JSON. Device data is retained for retry.');
    return await response.json();
  },
  async _flushPending() {
    if (navigator.onLine === false) {this._updateBadge('offline');return false;}
    this._running = true;
    try {
      let queue = await IDB.queueGetAll();
      while (queue.length) {
        this._updateBadge('syncing');
        for (const op of queue) {
          const batch = op.type === 'batch';
          if (!batch && !['set', 'patch', 'del'].includes(op.type)) throw new Error('An unsupported queued operation needs review.');
          const method = batch || op.type === 'patch' ? 'PATCH' : op.type === 'del' ? 'DELETE' : 'PUT';
          const acknowledgement = await this._request(batch ? '' : op.path, {method, headers: {'Content-Type': 'application/json'},
            ...(op.type === 'del' ? {} : {body: JSON.stringify(batch ? {__posCommand:{id:op.commandId,updates:op.data,guards:op.guards||[]}} : op.data)})});
          if (batch && (acknowledgement?.ok !== true || acknowledgement.id !== op.commandId)) {
            throw new Error('The cloud API could not confirm this save. The transaction is still on this device.');
          }
          this._lastContact = Date.now();
          await IDB.queueDelete(op.id);
        }
        queue = await IDB.queueGetAll();
      }
      if (this._lastContact) this._updateBadge('connected');
      return true;
    } catch (error) {
      console.warn('Cloud sync pending', error.message);
      this._showFailure(error);
      return false;
    } finally {this._running = false;}
  },
  flush() {
    if (!this._flushPromise) this._flushPromise = this._lock(() => this._flushPending()).catch(error => {this._updateBadge('error');console.warn('Cloud sync pending', error.message);return false;}).finally(() => {this._flushPromise = null;});
    return this._flushPromise;
  },
  pull() {
    if (!this._pullPromise) this._pullPromise = this._lock(async () => {
      if (!await this._flushPending()) return false;
      this._updateBadge('syncing');
      try {
        const snapshot = await this._request('');
        if (snapshot !== null && (typeof snapshot !== 'object' || Array.isArray(snapshot))) throw new Error('The cloud snapshot has an invalid format.');
        const remote = snapshot || {};
        const db = await IDB.open();
        let applied = false;
        let settings = null;
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(['cache', 'queue'], 'readwrite');
          const store = transaction.objectStore('cache');
          const pending = transaction.objectStore('queue').count();
          pending.onsuccess = () => {
            if (pending.result > 0) return;
            applied = true;
            for (const root of CacheTree.roots) {
              store.put({path: root, data: remote[root] || {}, ts: Date.now()});
              const children = store.openCursor(IDBKeyRange.bound(root + '/', root + '/\uffff'));
              children.onsuccess = () => {const cursor = children.result;if (cursor) {cursor.delete();cursor.continue();}};
            }
            if (remote.settings?.main && typeof remote.settings.main === 'object') {
              settings = {...S.settings, ...remote.settings.main};
              settings.apiServerUrl = S.settings.apiServerUrl || '';
              settings.receiptNote = normalizeReceiptNote(settings.receiptNote);
              store.put({path: 'settings', data: {main: settings}, ts: Date.now()});
            }
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
        if (settings) Object.assign(S.settings, settings);
        if (applied) {this._lastContact = Date.now();await loadAll();this._updateBadge('connected');}
        else this._updateBadge('pending');
        return applied;
      } catch (error) {console.warn('Cloud refresh pending', error.message);this._showFailure(error);return false;}
    }).catch(error => {this._updateBadge('error');console.warn('Cloud refresh pending', error.message);return false;}).finally(() => {this._pullPromise = null;});
    return this._pullPromise;
  },
  _showFailure(error) {
    const state = navigator.onLine === false ? 'offline'
      : error.code === 'CLOUD_SIGN_IN_REQUIRED' ? 'locked'
      : error.code === 'CLOUD_SETUP_REQUIRED' ? 'setup'
      : error.status === 409 ? 'conflict' : 'error';
    this._updateBadge(state, error.message);
    if (state === 'locked' && typeof CloudAccess !== 'undefined') CloudAccess.needsSignIn();
  },
  _updateBadge(state, detail) {
    const dot = document.getElementById('syncDot');
    if (!dot) return;
    const labels = {connected: 'Cloud connected', pending: 'Changes pending', syncing: 'Syncing changes', offline: 'Offline, saved on this device', error: 'Cloud unavailable, retrying', locked: 'Connect this device', setup: 'Cloud setup pending', conflict: 'Sync needs review. Changes are saved on this device.'};
    dot.dataset.state = state;
    dot.className = 'sync-dot' + (state === 'connected' ? '' : state === 'syncing' || state === 'pending' ? ' syncing' : ' offline');
    dot.title = detail && state !== 'offline' ? detail : labels[state] || labels.pending;
    dot.setAttribute('aria-label', dot.title);
  },
  start() {
    if (this._started) return;
    this._started = true;
    window.addEventListener('online', () => {void this.pull();});
    window.addEventListener('offline', () => this._updateBadge('offline'));
    window.addEventListener('focus', () => {if (navigator.onLine !== false) void this.pull();});
    this._timer = setInterval(() => {if (navigator.onLine !== false) void this.pull();}, 10000);
    void this.pull();
  }
};

const DB = {
  newId() {return 'local_' + (globalThis.crypto?.randomUUID?.() || Date.now() + '_' + Math.random().toString(36).slice(2));},
  _sync() {},
  async get(path) {return await IDB.cacheGet(path) || {};},
  async batch(operations) {
    await IDB.commit(operations);
    Sync._updateBadge(navigator.onLine === false ? 'offline' : 'pending');
    scheduleDataRefresh();
    void Sync.flush().catch(error => console.warn('Cloud retry pending', error.message));
  },
  async push(path, data) {const id = this.newId();await this.batch([{type: 'set', path: path + '/' + id, data}]);return id;},
  set(path, data) {return this.batch([{type: 'set', path, data}]);},
  patch(path, data) {return this.batch([{type: 'patch', path, data}]);},
  del(path) {return this.batch([{type: 'del', path}]);},
  obj2arr(object) {return Object.entries(object || {}).filter(([, value]) => value && typeof value === 'object').map(([id, value]) => ({...value, id}));}
};
const Drafts = {
  ready: false,
  _write: Promise.resolve(),
  async restore() {
    let mirror = null;
    try {mirror = JSON.parse(localStorage.getItem('chicken-pos-draft-v1') || 'null');} catch {}
    const stored = await IDB.cacheGet('__deviceDraft');
    const draft = mirror && (!stored || mirror.savedAt > stored.savedAt) ? mirror : stored;
    if (draft && Array.isArray(draft.cart)) {
      S.cart = draft.cart.filter(line => line && Number.isFinite(Number(line.qty)) && Number(line.qty) > 0);
      S.cartDisc = Math.max(0, Number(draft.cartDisc) || 0);
      S.cartDiscType = draft.cartDiscType === 'fixed' ? 'fixed' : 'percent';
      S.heldSales = Array.isArray(draft.heldSales) ? draft.heldSales : [];
      POS.restoreMode(draft.mode);
    }
    this.ready = true;
    Cart.render();
  },
  save() {
    if (!this.ready) return;
    const data = CacheTree.clone({cart:S.cart,cartDisc:S.cartDisc,cartDiscType:S.cartDiscType,heldSales:S.heldSales,mode:POS.currentMode,savedAt:Date.now()});
    try {localStorage.setItem('chicken-pos-draft-v1', JSON.stringify(data));} catch {}
    this._write = this._write.catch(() => {}).then(() => IDB.cacheSet('__deviceDraft',data)).catch(error => {
      if (!this._warned) {this._warned=true;toast('The current cart could not be saved on this device. Check available storage.','error');}
      console.warn('Draft save failed',error.message);
    });
    return this._write;
  }
};
