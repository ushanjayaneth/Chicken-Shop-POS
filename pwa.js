/* Service-worker updates preserve the current device database and saved cart. */
const PWA = {
  _started: false,
  _registration: null,
  _waiting: null,
  _applying: false,
  _reloaded: false,
  _postponed: false,
  _externalUpdate: false,
  _busy() {
    return (typeof Checkout !== 'undefined' && Checkout._busy) ||
      (typeof LoanMgr !== 'undefined' && LoanMgr._busy) ||
      (typeof CoconutMgr !== 'undefined' && CoconutMgr._mutationPending) ||
      (typeof BackupMgr !== 'undefined' && BackupMgr._busy) ||
      (typeof SaleDetail !== 'undefined' && SaleDetail._busy) ||
      (typeof DayEnd !== 'undefined' && (DayEnd._busy || DayEnd._saving)) ||
      (typeof ItemForm !== 'undefined' && (ItemForm._busy || ItemForm._saving)) ||
      (typeof StockAdd !== 'undefined' && (StockAdd._busy || StockAdd._saving));
  },
  _mount() {
    if (document.getElementById('pwaUpdateDialog')) return;
    const style = document.createElement('style');
    style.textContent = `
      #pwaUpdateDialog {box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:28px;margin:auto;border:1px solid #3b4037;border-radius:20px;background:#191d18;color:#f1f3ed;font-family:Inter,Arial,sans-serif;box-shadow:0 24px 100px #0009;overflow:auto;}
      #pwaUpdateDialog::backdrop {background:#070a08b3;backdrop-filter:blur(5px);}
      #pwaUpdateDialog h2 {font-size:22px;line-height:1.25;letter-spacing:-.5px;margin:0 0 12px;font-weight:700;}
      #pwaUpdateDialog p {font-size:14px;line-height:1.65;color:#b7bfb2;margin:0 0 16px;}
      #pwaUpdateStatus:empty {display:none;}
      #pwaUpdateDialog .pwa-actions {display:flex;gap:10px;justify-content:flex-end;margin-top:24px;flex-wrap:wrap;}
      #pwaUpdateDialog button,#pwaUpdateButton {font:inherit;font-size:13px;font-weight:600;min-height:44px;border-radius:10px;padding:10px 16px;cursor:pointer;}
      #pwaUpdateLater {border:1px solid #41483c;background:transparent;color:#e7ecdf;}
      #pwaUpdateNow {border:1px solid #dbb26a;background:#dfb66f;color:#211a10;}
      #pwaUpdateDialog button:disabled {opacity:.6;cursor:wait;}
      #pwaUpdateDialog button:focus-visible,#pwaUpdateButton:focus-visible {outline:3px solid #ecce91;outline-offset:3px;}
      #pwaUpdateButton {border:1px solid #a18246;background:#29271d;color:#efd397;white-space:nowrap;}
      #pwaUpdateButton[hidden] {display:none;}
      @media(max-width:650px){#pwaUpdateDialog{padding:24px;}#pwaUpdateButton{font-size:11px;padding:7px 9px;min-height:36px;}#pwaUpdateDialog .pwa-actions button{flex:1;}}
    `;
    document.head.appendChild(style);
    const dialog = document.createElement('dialog');
    dialog.id = 'pwaUpdateDialog';
    dialog.setAttribute('aria-labelledby', 'pwaUpdateTitle');
    dialog.setAttribute('aria-describedby', 'pwaUpdateDescription');
    dialog.innerHTML = `<h2 id="pwaUpdateTitle">An update is ready</h2>
      <p id="pwaUpdateDescription">Update and reopen Chicken House POS. Your saved business data, current cart and pending offline changes will be kept.</p>
      <p id="pwaUpdateStatus" role="status" aria-live="polite"></p>
      <div class="pwa-actions"><button type="button" id="pwaUpdateLater">Later</button><button type="button" id="pwaUpdateNow">Update &amp; reopen</button></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => {event.preventDefault();if (!this._applying) this.later();});
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!this._applying) this.later();
    });
    document.getElementById('pwaUpdateLater').addEventListener('click', () => this.later());
    document.getElementById('pwaUpdateNow').addEventListener('click', () => {void this.apply();});
    const button = document.createElement('button');
    button.id = 'pwaUpdateButton';
    button.type = 'button';
    button.textContent = 'Update available';
    button.hidden = true;
    button.addEventListener('click', () => {this._postponed=false;this.show();});
    const actions = document.querySelector('#nav .nav-right');
    if (actions) actions.prepend(button);
    else {button.style.cssText='position:fixed;right:16px;bottom:80px;z-index:10000';document.body.appendChild(button);}
  },
  show() {
    if (!this._waiting && !this._externalUpdate) return;
    document.getElementById('pwaUpdateButton').hidden = false;
    if (this._postponed || this._applying) return;
    if (this._busy() || document.querySelector('.overlay.open') || document.hidden) {
      clearTimeout(this._promptTimer);
      this._promptTimer = setTimeout(() => this.show(), 1000);
      return;
    }
    const dialog = document.getElementById('pwaUpdateDialog');
    if (!dialog.open) {this._previousFocus=document.activeElement;dialog.showModal();}
  },
  later() {
    if (this._applying) return;
    this._postponed = true;
    document.getElementById('pwaUpdateDialog').close();
    this._previousFocus?.focus?.({preventScroll:true});
  },
  async _saveBeforeReload() {
    const deadline = Date.now() + 15000;
    while (this._busy()) {
      if (Date.now() > deadline) throw new Error('Finish the current transaction, then update.');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (typeof Drafts !== 'undefined') {
      await Drafts.save();
      await Drafts._write;
    }
  },
  _reload() {
    if (this._reloaded) return;
    this._reloaded = true;
    location.reload();
  },
  async apply() {
    if (this._applying) return;
    const worker = this._registration?.waiting || this._waiting;
    if (!worker && !this._externalUpdate) return;
    this._applying = true;
    const now = document.getElementById('pwaUpdateNow');
    const later = document.getElementById('pwaUpdateLater');
    const status = document.getElementById('pwaUpdateStatus');
    now.disabled = true;
    later.disabled = true;
    status.textContent = 'Saving the current cart…';
    try {
      await this._saveBeforeReload();
      status.textContent = 'Applying the update…';
      if (this._externalUpdate || worker?.state === 'activated') {this._reload();return;}
      worker.postMessage({type:'SKIP_WAITING'});
      this._activationTimer = setTimeout(() => {
        if (this._reloaded) return;
        this._applying=false;
        now.disabled=false;
        later.disabled=false;
        status.textContent='The update is still being prepared. Please try again.';
      }, 15000);
    } catch (error) {
      this._applying = false;
      now.disabled = false;
      later.disabled = false;
      status.textContent = error.message || 'The update could not be applied. Please try again.';
    }
  },
  _watch(worker) {
    if (!worker) return;
    const changed = () => {
      if (worker.state !== 'installed') return;
      if (navigator.serviceWorker.controller) {
        this._waiting = this._registration.waiting || worker;
        this._postponed = false;
        this.show();
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  },
  async _check() {
    if (!this._registration || navigator.onLine === false) return;
    try {await this._registration.update();} catch {}
  },
  async setup() {
    if (this._started) return;
    this._started = true;
    if (navigator.storage?.persist) {
      void (async () => {
        try {
          const granted = await navigator.storage.persisted?.() || await navigator.storage.persist();
          document.documentElement.dataset.persistentStorage = granted ? 'granted' : 'best-effort';
        } catch {document.documentElement.dataset.persistentStorage='best-effort';}
      })();
    }
    if (!('serviceWorker' in navigator)) return;
    this._mount();
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const isUpdate = hadController;
      hadController = true;
      document.documentElement.dataset.offlineReady = 'true';
      if (this._applying) {clearTimeout(this._activationTimer);this._reload();return;}
      if (isUpdate) {this._externalUpdate=true;this._postponed=false;this.show();}
    });
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'});
      this._registration = registration;
      registration.addEventListener('updatefound', () => this._watch(registration.installing));
      this._watch(registration.installing);
      if (registration.waiting && navigator.serviceWorker.controller) {this._waiting=registration.waiting;this.show();}
      void navigator.serviceWorker.ready.then(() => {
        document.documentElement.dataset.offlineReady = 'true';
        window.dispatchEvent(new CustomEvent('pwa:ready'));
      });
      document.addEventListener('visibilitychange', () => {if (!document.hidden) void this._check();});
      window.addEventListener('online', () => {void this._check();});
      this._checkTimer = setInterval(() => {void this._check();}, 10 * 60 * 1000);
    } catch (error) {
      document.documentElement.dataset.offlineReady = navigator.serviceWorker.controller ? 'true' : 'false';
      console.warn('Offline shell preparation pending', error.message);
    }
  }
};
