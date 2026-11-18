/* Complete local snapshots include pending offline changes and both business workspaces. */
const BackupStore = {
  format: 'mr-chicken-house-backup',
  version: 2,
  clone(value) {return JSON.parse(JSON.stringify(value));},
  validateData(value, depth = 0) {
    if (depth > 100) throw new Error('The backup contains excessively nested data.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object') throw new Error('The backup contains invalid values.');
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('The backup contains an unsafe field.');
      this.validateData(child, depth + 1);
    }
  },
  collection(value, label) {
    if (!Array.isArray(value)) {
      if (value === null || typeof value === 'object') return value;
      throw new Error(`The ${label} collection is invalid.`);
    }
    const records = {};
    for (const row of value) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) throw new Error(`A ${label} record has no valid ID.`);
      CacheTree.path(row.id);
      if (row.id.includes('/') || Object.hasOwn(records, row.id)) throw new Error(`A ${label} record has an invalid or repeated ID.`);
      const {id, ...record} = row;
      records[id] = record;
    }
    return records;
  },
  normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a valid POS JSON backup.');
    this.validateData(input);
    let rows;
    if (input.format === this.format) {
      if (input.version !== this.version || !Array.isArray(input.cache) || !Array.isArray(input.pendingQueue)) throw new Error('This backup version or structure is unsupported.');
      rows = input.cache;
      for (const operation of input.pendingQueue) {
        if (!operation || !['batch', 'set', 'patch', 'del'].includes(operation.type)) throw new Error('The backup has an invalid pending operation.');
        if (operation.type === 'batch') {
          if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) throw new Error('The backup has an invalid pending batch.');
          Object.keys(operation.data).forEach(path => CacheTree.path(path));
        } else CacheTree.path(operation.path);
      }
    } else if (Array.isArray(input.items) || Array.isArray(input.sales) || Array.isArray(input.categories)) {
      rows = [];
      for (const root of CacheTree.roots) if (Object.hasOwn(input, root)) rows.push({path:root, data:this.collection(input[root], root)});
      if (input.settings) rows.push({path:'settings', data:{main:input.settings}});
    } else {
      rows = Object.entries(input).filter(([path]) => path !== '__settings' && path !== 'exportDate').map(([path, data]) => ({path, data}));
      if (input.__settings && !rows.some(row => row.path === 'settings' || row.path === 'settings/main')) rows.push({path:'settings/main', data:input.__settings});
    }
    const roots = new Map();
    const seen = new Set();
    const ordered = [...rows].sort((a, b) => String(b?.path).split('/').length - String(a?.path).split('/').length);
    for (const row of ordered) {
      if (!row || !Object.hasOwn(row, 'data')) throw new Error('The backup contains an incomplete local record.');
      const parts = CacheTree.path(row.path);
      if (seen.has(row.path)) throw new Error('The backup contains repeated local paths.');
      seen.add(row.path);
      if (parts[0].startsWith('__') && parts[0] !== '__deviceDraft') continue;
      roots.set(parts[0], CacheTree.put(roots.get(parts[0]), parts.slice(1), row.data));
    }
    if (![...roots.keys()].some(root => CacheTree.roots.includes(root) || root === 'settings')) throw new Error('The file contains no recognizable POS data.');
    const draft = roots.get('__deviceDraft');
    if (draft && (!Array.isArray(draft.cart) || !Array.isArray(draft.heldSales || []))) throw new Error('The saved cart in the backup is invalid.');
    const cache = [...roots].map(([path, data]) => ({path, data, ts:Date.now()}));
    const updates = {};
    for (const root of [...CacheTree.roots, 'settings']) updates[root] = roots.has(root) ? roots.get(root) : null;
    for (const [root, data] of roots) if (!root.startsWith('__')) updates[root] = data;
    return {cache, updates, draft: draft || null};
  },
  async snapshot() {
    const db = await IDB.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cache', 'queue']);
      const cache = transaction.objectStore('cache').getAll();
      const queue = transaction.objectStore('queue').getAll();
      transaction.oncomplete = () => resolve({format:this.format, version:this.version, exportedAt:new Date().toISOString(), cache:cache.result.filter(row => row.path !== '__syncLease'), pendingQueue:queue.result});
      transaction.onerror = () => reject(transaction.error || new Error('The device could not read the backup.'));
      transaction.onabort = () => reject(transaction.error || new Error('The backup read was canceled.'));
    });
  },
  async replace(snapshot) {
    const db = await IDB.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cache', 'queue'], 'readwrite');
      const cache = transaction.objectStore('cache');
      const queue = transaction.objectStore('queue');
      try {
        cache.clear();
        queue.clear();
        for (const row of snapshot.cache) cache.put(row);
        // The snapshot already includes its queued changes. One new command restores
        // that resulting state without replaying earlier payments or stock deductions.
        queue.add({type:'batch', data:snapshot.updates, guards:[], commandId:DB.newId(), ts:Date.now()});
      } catch (error) {transaction.abort();reject(error);}
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('The backup could not be saved. Existing data was retained.'));
      transaction.onabort = () => reject(transaction.error || new Error('Restore was canceled. Existing data was retained.'));
    });
  },
  async restore(input) {
    const snapshot = this.normalize(input);
    const ready = Drafts.ready;
    Drafts.ready = false;
    try {
      await Drafts._write;
      const replaced = await Sync._lock(async () => {await this.replace(snapshot);return true;});
      if (!replaced) throw new Error('Another POS tab is synchronizing. Try restoring again shortly.');
      try {
        if (snapshot.draft) localStorage.setItem('chicken-pos-draft-v1', JSON.stringify(snapshot.draft));
        else localStorage.removeItem('chicken-pos-draft-v1');
        localStorage.removeItem('jm_settings');
      } catch {}
      return snapshot;
    } finally {Drafts.ready = ready;}
  }
};

const BackupMgr = {
  _busy: false,
  async applyRestoredState() {
    S.cart = [];
    S.heldSales = [];
    S.cartDisc = 0;
    S.cartDiscType = 'fixed';
    POS.currentMode = 'retail';
    S.settings = {shopName:'Mr. Chicken House', adminPin:'1234', currency:'Rs.', lowStockAlert:5, receiptNote:DEFAULT_RECEIPT_NOTE, apiServerUrl:'', ...await DB.get('settings/main')};
    await loadAll(true);
    await Drafts.restore();
    Admin.lock();
  },
  async download() {
    if (this._busy) return;
    this._busy = true;
    try {
      await Drafts.save();
      const data = await BackupStore.snapshot();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Chicken-House-Backup-${localBusinessDate()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup downloaded with sales, stock, loans, coconut records and pending changes.', 'success');
    } catch (error) {toast('Backup failed. ' + error.message, 'error');}
    finally {this._busy = false;}
  },
  async restore(file) {
    if (!file || this._busy) return;
    this._busy = true;
    try {
      const input = JSON.parse(await file.text());
      const preview = BackupStore.normalize(input);
      const itemRoot = preview.cache.find(row => row.path === 'items');
      const itemCount = Object.keys(itemRoot?.data || {}).length;
      if (!confirm(`Restore this backup with ${itemCount} products? This replaces the current local and shared cloud records, including sales, loans and coconut records. Pending changes on this device will be replaced by this snapshot.`)) return;
      await BackupStore.restore(input);
      await this.applyRestoredState();
      Sync._updateBadge(navigator.onLine === false ? 'offline' : 'pending');
      toast(navigator.onLine === false ? 'Backup restored on this device. Cloud upload will resume when online.' : 'Backup restored on this device. Synchronizing the restored data.', 'success');
      void Sync.pull();
    } catch (error) {toast('Restore failed. ' + error.message, 'error');}
    finally {this._busy = false;}
  }
};

const Backup = {
  export() {return BackupMgr.download();},
  async import(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    try {await BackupMgr.restore(file);} finally {if (input) input.value = '';}
  },
  async factoryReset() {
    if (!confirm('Reset all stock, sales, loans, coconut records and settings on every connected device? This action is permanent.')) return;
    if (prompt('Enter Admin PIN to confirm:') !== String(S.settings.adminPin)) {toast('Incorrect PIN. Reset canceled.', 'error');return;}
    if (BackupMgr._busy) return;
    BackupMgr._busy = true;
    try {
      const settings = {shopName:'Mr. Chicken House', adminPin:'1234', currency:'Rs.', lowStockAlert:5, receiptNote:DEFAULT_RECEIPT_NOTE};
      const data = {format:BackupStore.format, version:BackupStore.version, cache:[{path:'settings', data:{main:settings}}], pendingQueue:[]};
      await BackupStore.restore(data);
      await BackupMgr.applyRestoredState();
      toast(navigator.onLine === false ? 'Local reset complete. The shared cloud reset is pending internet access.' : 'Local reset complete. Synchronizing the shared reset.', 'success');
      void Sync.pull();
    } catch (error) {toast('Reset failed. ' + error.message, 'error');}
    finally {BackupMgr._busy = false;}
  },
  async clearSales() {
    if (!confirm('Permanently delete all sales history from this device and the shared cloud database?')) return;
    try {await DB.del('sales');await loadAll();toast('Sales history cleared. Cloud changes are queued.', 'success');}
    catch (error) {toast('Sales history could not be cleared. ' + error.message, 'error');}
  }
};
