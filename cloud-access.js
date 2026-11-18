const CloudAccess = {
  _prompted: false,
  needsSignIn() {
    if (this._prompted || S.items.length || S.sales.length || S.loans.length || S.coconut_purchases.length) return;
    this._prompted = true;
    this.open();
  },
  open() {
    if (navigator.onLine === false) {
      toast('Reconnect to the internet to connect this device.', 'info');
      return;
    }
    if (!document.getElementById('cloudAccessModal')) {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.id = 'cloudAccessModal';
      overlay.innerHTML = '<div class="modal"><div class="modal-head"><div class="modal-title">Connect this device</div>' +
        '<button type="button" class="modal-x" aria-label="Close" onclick="Modal.close(\'cloudAccessModal\')">×</button></div>' +
        '<form id="cloudAccessForm"><p class="cloud-access-description">Enter the workspace access key to load and sync shop records on this device.</p>' +
        '<div class="form-group"><label for="cloudAccessKey">Workspace access key</label>' +
        '<input id="cloudAccessKey" type="password" required maxlength="256" autocomplete="current-password"></div>' +
        '<div id="cloudAccessError" role="status" aria-live="polite"></div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="Modal.close(\'cloudAccessModal\')">Cancel</button>' +
        '<button type="submit" class="btn btn-primary" id="cloudAccessSubmit">Connect</button></div></form></div>';
      document.body.append(overlay);
      document.getElementById('cloudAccessForm').addEventListener('submit', event => {
        event.preventDefault();
        void this.connect();
      });
    }
    Modal.open('cloudAccessModal');
    document.getElementById('cloudAccessKey').focus();
  },
  async connect() {
    const input = document.getElementById('cloudAccessKey');
    const button = document.getElementById('cloudAccessSubmit');
    const status = document.getElementById('cloudAccessError');
    button.disabled = true;
    status.textContent = '';
    try {
      const url = new URL(getApiUrl(''), location.href);
      url.pathname = url.pathname.replace(/\/data\/?$/, '/session');
      const response = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify({key:input.value.trim()}),
        signal:AbortSignal.timeout(12000)
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'Cloud access could not be verified.');
      input.value = '';
      Modal.close('cloudAccessModal');
      await Sync.pull();
    } catch (error) {
      status.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'Unable to reach the server. Check your connection and try again.'
        : error.message;
      input.select();
    } finally {
      button.disabled = false;
    }
  }
};
