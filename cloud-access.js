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
        '<form id="cloudAccessForm"><p class="cloud-access-description">Enter the workspace PIN to load and sync shop records on this device.</p>' +
        '<div class="form-group"><label for="cloudAccessPin">Workspace PIN</label>' +
        '<input id="cloudAccessPin" type="password" inputmode="numeric" pattern="[0-9]{4,12}" required maxlength="12" autocomplete="current-password"></div>' +
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
    document.getElementById('cloudAccessPin').focus();
  },
  async _request(method, body) {
    const url = new URL(getApiUrl(''), location.href);
    url.pathname = url.pathname.replace(/\/data\/?$/, '/session');
    const response = await fetch(url,{
      method,headers:{'Content-Type':'application/json'},credentials:'same-origin',
      body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'Workspace access could not be verified.');
  },
  _errorMessage(error) {
    return error.name === 'TypeError' || error.name === 'TimeoutError'
      ? 'Unable to reach the server. Check your connection and try again.'
      : error.message;
  },
  async connect() {
    const input = document.getElementById('cloudAccessPin');
    const button = document.getElementById('cloudAccessSubmit');
    const status = document.getElementById('cloudAccessError');
    button.disabled = true;
    status.textContent = '';
    try {
      await this._request('POST',{pin:input.value.trim()});
      input.value = '';
      Modal.close('cloudAccessModal');
      if (!await Sync.pull()) await Sync.pull();
    } catch (error) {
      status.textContent = this._errorMessage(error);
      input.select();
    } finally {
      button.disabled = false;
    }
  },
  async changePin() {
    const current = document.getElementById('workspaceCurrentPin');
    const next = document.getElementById('workspaceNextPin');
    const confirm = document.getElementById('workspaceConfirmPin');
    const button = document.getElementById('workspacePinSubmit');
    const status = document.getElementById('workspacePinStatus');
    status.textContent = '';
    if (next.value !== confirm.value) {
      status.textContent = 'The new PINs do not match.';
      return;
    }
    button.disabled = true;
    try {
      await this._request('PATCH',{currentPin:current.value.trim(),nextPin:next.value.trim()});
      current.value = next.value = confirm.value = '';
      status.textContent = 'Workspace PIN updated.';
      toast('Workspace PIN updated', 'success');
    } catch (error) {
      status.textContent = this._errorMessage(error);
    } finally {
      button.disabled = false;
    }
  }
};
