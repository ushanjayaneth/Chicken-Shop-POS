    const Settings = {
      _saving: false,
      _pinSaving: false,
      _opened: null,
      apiBase(value) {
        const base = String(value || '').trim().replace(/\/+$/, '');
        if (!base) return '';
        if (!/^https?:\/\//i.test(base) && !/^\/(?!\/)/.test(base)) throw new Error('Enter a valid API server URL.');
        const url = new URL(base, location.origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP or HTTPS API server URL without credentials, a query or a fragment.');
        return url.href.replace(/\/+$/, '');
      },
      async open() {
        try { this._opened = await DB.get('settings/main') || {}; }
        catch (error) { toast(error.message || 'Settings could not be loaded.', 'error'); return false; }
        Object.assign(S.settings, this._opened);
        S.settings.receiptNote = normalizeReceiptNote(S.settings.receiptNote);
        document.getElementById('settingsBody').innerHTML = `
      <div class="form-group"><label>Shop Name</label><input id="setName" type="text" value="${esc(S.settings.shopName)}" inputmode="text"></div>
      <div class="grid-2">
        <div class="form-group"><label>Currency Symbol</label><input id="setCur" type="text" value="${esc(S.settings.currency)}" inputmode="text"></div>
        <div class="form-group"><label>Low Stock Alert</label><input id="setLow" type="number" step="0.001" value="${S.settings.lowStockAlert ?? 5}" min="0" inputmode="numeric"></div>
      </div>
      <div class="form-group"><label>Receipt Footer Note</label><input id="setNote" type="text" value="${esc(S.settings.receiptNote || '')}" inputmode="text"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">🔑 Change Admin PIN</div>
      <div class="grid-3">
        <div class="form-group"><label>Current PIN</label><input id="curPin" type="password" maxlength="12" placeholder="••••" inputmode="numeric" pattern="[0-9]*"></div>
        <div class="form-group"><label>New PIN</label><input id="newPin" type="password" maxlength="12" placeholder="New PIN" inputmode="numeric" pattern="[0-9]*"></div>
        <div class="form-group"><label>Confirm PIN</label><input id="confPin" type="password" maxlength="12" placeholder="Confirm" inputmode="numeric" pattern="[0-9]*"></div>
      </div>
      <button class="btn btn-orange btn-sm mb-12" onclick="Settings.changePin()">🔑 Change PIN</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">Workspace PIN</div>
      <div class="cloud-access-description">Controls access to shared cloud records. Set a new 6–12 digit PIN while online.</div>
      <form id="workspacePinForm">
        <div class="grid-3">
          <div class="form-group"><label for="workspaceCurrentPin">Current PIN</label>
            <input id="workspaceCurrentPin" type="password" required pattern="[0-9]{4,12}" maxlength="12" inputmode="numeric" autocomplete="current-password"></div>
          <div class="form-group"><label for="workspaceNextPin">New PIN</label>
            <input id="workspaceNextPin" type="password" required pattern="[0-9]{6,12}" maxlength="12" inputmode="numeric" autocomplete="new-password"></div>
          <div class="form-group"><label for="workspaceConfirmPin">Confirm PIN</label>
            <input id="workspaceConfirmPin" type="password" required pattern="[0-9]{6,12}" maxlength="12" inputmode="numeric" autocomplete="new-password"></div>
        </div>
        <div id="workspacePinStatus" role="status" aria-live="polite"></div>
        <button type="submit" class="btn btn-ghost btn-sm" id="workspacePinSubmit">Change workspace PIN</button>
      </form>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">⚙️ Hardware Connections (USB / Bluetooth)</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${['scanner', 'receipt', 'bcPrint', 'drawer'].map(id => `
        <div class="bt-status-bar" style="margin-bottom:0;padding:8px 12px;">
          <div class="bt-status-indicator" id="hwDot_${id}"></div>
          <div style="flex:1" id="hwTxt_${id}"><strong>...</strong><br><span style="font-size:11px;color:var(--t2)">Status: ...</span></div>
          <div style="display:flex;gap:6px;">
            ${id !== 'scanner' ? `<button class="btn btn-sm btn-purple" id="hwBT_${id}" onclick="HW.connect('${id}', 'bt')">📡 BT</button>
            <button class="btn btn-sm btn-purple" id="hwUSB_${id}" onclick="HW.connect('${id}', 'usb')">🔌 USB</button>` : ''}
            ${id === 'scanner' ? `<button class="btn btn-sm btn-purple" id="hwCAM_${id}" onclick="HW.connect('${id}', 'camera')">📷 Device Camera</button>` : `<button class="btn btn-sm btn-purple" id="hwLAN_${id}" onclick="HW.connect('${id}', 'lan')">System printing</button>`}
          </div>
        </div>`).join('')}
        </div><div class="info-hint" style="font-size:11px;margin-top:12px;">
        ⚠️ USB / Bluetooth connection requires <strong>Chrome or Edge</strong> browser on Desktop/Android.<br>
        Cash drawer can connect separately or works automatically via Printer Machine.<br>
        Normal barcode scanners that act as a keyboard do not need to be connected here.
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">💾 Backup & Restore</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
         <button class="btn btn-sm btn-ghost" style="border:1px solid var(--border); color:var(--cyan);" onclick="Backup.export()">⬇️ Download Backup</button>
         <button class="btn btn-sm btn-ghost" style="border:1px solid var(--border); color:var(--orange);" onclick="document.getElementById('backupUpload').click()">⬆️ Restore Backup</button>
         <input type="file" id="backupUpload" style="display:none" accept=".json" onchange="Backup.import(event)">
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:10px">⚠️ Danger Zone</div>
      <div style="margin-bottom:10px;">
         <button class="btn btn-sm btn-danger" onclick="Backup.factoryReset()">⚠️ Factory Reset</button>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('settingsModal')">Cancel</button>
        <button class="btn btn-primary" onclick="Settings.save()">💾 Save Settings</button>
      </div>`;
        document.getElementById('workspacePinForm').addEventListener('submit', event => {
          event.preventDefault();
          void CloudAccess.changePin();
        });
        Modal.open('settingsModal');
        const setNameInput = document.getElementById('setName');
        if (setNameInput) setNameInput.focus();
        HW.updateUI();
      },
      async changePin() {
        if (this._pinSaving) return false;
        this._pinSaving = true;
        try {
          const currentPIN = document.getElementById('curPin').value;
          const nextPIN = document.getElementById('newPin').value;
          const confirmation = document.getElementById('confPin').value;
          const saved = await DB.get('settings/main') || S.settings;
          if (currentPIN !== String(saved.adminPin ?? '')) throw new Error('The current PIN is incorrect.');
          if (!/^\d{4,12}$/.test(nextPIN)) throw new Error('Enter a new PIN with 4 to 12 digits.');
          if (nextPIN !== confirmation) throw new Error('The new PINs do not match.');
          await DB.batch([{type:'patch', path:'settings/main', data:{adminPin:nextPIN}, expected:{adminPin:saved.adminPin ?? null}}]);
          S.settings.adminPin = nextPIN;
          for (const id of ['curPin','newPin','confPin']) document.getElementById(id).value = '';
          toast('Admin PIN updated', 'success');
          return true;
        } catch (error) { toast(error.message || 'The PIN could not be saved.', 'error'); return false; }
        finally { this._pinSaving = false; }
      },
      async save() {
        if (this._saving) return false;
        this._saving = true;
        try {
          const shopName = document.getElementById('setName').value.trim();
          const currency = document.getElementById('setCur').value.trim();
          const lowText = document.getElementById('setLow').value.trim();
          const lowStockAlert = lowText === '' ? 5 : Number(lowText);
          if (!shopName) throw new Error('Enter the shop name.');
          if (!currency) throw new Error('Enter the currency symbol.');
          if (!Number.isFinite(lowStockAlert) || lowStockAlert < 0) throw new Error('Enter a valid low stock threshold.');
          const data = {shopName,currency,lowStockAlert,receiptNote:normalizeReceiptNote(document.getElementById('setNote').value)};
          const customAPI = document.getElementById('setApi');
          if (customAPI) data.apiServerUrl = this.apiBase(customAPI.value);
          const opened = this._opened || S.settings;
          const expected = Object.fromEntries(Object.keys(data).map(key=>[key,opened[key] ?? null]));
          await DB.batch([{type:'patch',path:'settings/main',data,expected}]);
          Object.assign(S.settings,data);
          Modal.close('settingsModal');
          await loadAll();
          toast('Settings saved', 'success');
          return true;
        } catch (error) { toast(error.message || 'Settings could not be saved.', 'error'); return false; }
        finally { this._saving = false; }
      }
    };


    const BarcodeTab = {
      _codes: [], // currently generated barcode strings

      render() {
        // Just refresh the preview if we have codes
        this._renderList();
        this._renderPreview();
      },

      filter() { }, // no-op for this design

      generateBatch() {
        const prefix = (document.getElementById('bcPrefix')?.value.trim().toUpperCase() || 'CH');
        const countText = document.getElementById('bcGenCount')?.value.trim() || '40';
        const count = Number(countText);
        const priceText = document.getElementById('bcManualPrice')?.value.trim() || '';
        const priceValue = priceText === '' ? null : Number(priceText);
        if (!/^[A-Z0-9_-]{1,8}$/.test(prefix)) { toast('Use up to 8 letters, digits, hyphens or underscores for the barcode prefix.', 'error'); return false; }
        if (!Number.isInteger(count) || count < 1 || count > 40) { toast('Enter a barcode count from 1 to 40.', 'error'); return false; }
        if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue <= 0)) { toast('Enter a positive label price or leave it blank.', 'error'); return false; }
        const price = priceValue === null ? '' : priceValue.toFixed(2);
        const existing = new Set(this._codes.map(row => row.code || row));
        for (const item of S.items) for (const code of InventoryRules.barcodes(item)) existing.add(code);
        const generated = [];
        for (let attempt = 0; generated.length < count && attempt < 2000; attempt++) {
          const random = new Uint32Array(1);
          crypto.getRandomValues(random);
          const code = prefix + Date.now().toString().slice(-7) + random[0].toString().padStart(10, '0');
          if (!existing.has(code)) { generated.push({code,price}); existing.add(code); }
        }
        if (generated.length !== count) { toast('Unique barcodes could not be generated. Please try again.', 'error'); return false; }
        this._codes = generated;
        const status = document.getElementById('bcGenStatus');
        if (status) status.textContent = generated.length + ' barcodes ready to print';
        this._renderList();
        this._renderPreview();
        this._updateCount();
        toast(generated.length + ' barcodes generated', 'success');
        return true;
      },

      _renderList() {
        const list = document.getElementById('bcList'); if (!list) return;
        if (!this._codes.length) {
          list.innerHTML = `<div style="text-align:center;color:var(--t3);padding:40px 16px;font-size:12px;">👆 Click "Generate" to generate barcodes</div>`;
          return;
        }
        const cur = S.settings.currency;
        list.innerHTML = this._codes.map((item, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--border);">
        <input type="checkbox" class="bc-item-chk" data-code="${item.code || item}" data-price="${item.price || ''}" checked
          style="width:14px;height:14px;cursor:pointer;accent-color:var(--cyan);flex-shrink:0;"
          onchange="BarcodeTab._updateCount()">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--cyan);flex:1;">
          ${item.code || item}
          ${item.price ? `<div style="font-size:10px;color:var(--t3);font-family:'Exo 2',sans-serif;margin-top:2px;">${cur} ${parseFloat(item.price).toFixed(2)}</div>` : ''}
        </div>
        <div style="font-size:10px;color:var(--t3);">#${i + 1}</div>
      </div>`).join('');
        this._updateCount();
      },

      _updateCount() {
        const checked = document.querySelectorAll('.bc-item-chk:checked').length;
        const el = document.getElementById('bcSelCount');
        if (el) { el.textContent = checked; el.className = 'cnt' + (checked > 40 ? ' over' : ''); }
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._renderPreview(), 100);
      },

      _getSelectedCodes() {
        const codes = [];
        document.querySelectorAll('.bc-item-chk:checked').forEach(chk => {
          if (chk.dataset.code) codes.push({ code: chk.dataset.code, price: chk.dataset.price });
        });
        return codes;
      },

      _renderPreview() {
        const preview = document.getElementById('bcA4Preview'); if (!preview) return;
        const selected = this._getSelectedCodes();
        // Pad to 40
        const labels = [...selected];
        while (labels.length < 40) labels.push(null);

        preview.innerHTML = '';
        const cur = S.settings.currency;
        labels.forEach((item, idx) => {
          const cell = document.createElement('div');
          cell.className = 'bc-cell' + (item ? '' : ' empty');
          if (item) {
            cell.innerHTML = `
          ${item.price ? `<div class="bc-cell-price">${cur} ${parseFloat(item.price).toFixed(2)}</div>` : ''}
          <svg id="bcpv${idx}"></svg>
          <div class="bc-cell-num">${item.code}</div>`;
          }
          preview.appendChild(cell);
        });
        labels.forEach((item, idx) => {
          if (!item) return;
          requestAnimationFrame(() => {
            try { JsBarcode(`#bcpv${idx}`, item.code, { format: 'CODE128', width: 0.95, height: 26, displayValue: false, margin: 0, background: '#ffffff', lineColor: '#000000' }); } catch (e) { }
          });
        });
      },

      selectAll() { document.querySelectorAll('.bc-item-chk').forEach(c => c.checked = true); this._updateCount(); },
      clearAll() { document.querySelectorAll('.bc-item-chk').forEach(c => c.checked = false); this._updateCount(); },

      async doPrintHW() {
        const codes = this._getSelectedCodes();
        if (!codes.length) { toast('First generate barcodes, then print.', 'error'); return; }
        if (HW.devs.bcPrint.status === 'connected') {
          await HW.printBarcodes(codes, 'bcPrint');
        } else if (HW.devs.receipt.status === 'connected') {
          await HW.printBarcodes(codes, 'receipt');
        } else {
          toast('No Barcode Printer or Receipt Printer connected.', 'error');
        }
      },

      doPrintRoll() {
        const codes = this._getSelectedCodes();
        if (!codes.length) { toast('First generate barcodes, then print.', 'error'); return; }

        const shop = esc(S.settings.shopName);
        const cur = S.settings.currency;

        let rows = '';
        for (let i = 0; i < codes.length; i += 2) {
          const c1 = codes[i];
          const c2 = codes[i + 1];

          const lbl1 = c1 ? `
        <div class="sticker">
          <div class="s-shop">${shop}</div>
          ${c1.price ? `<div class="s-price">${cur} ${parseFloat(c1.price).toFixed(2)}</div>` : `<div class="s-price">&nbsp;</div>`}
          <svg id="sr${i}"></svg>
          <div class="s-num">${c1.code}</div>
        </div>` : '<div class="sticker empty"></div>';

          const lbl2 = c2 ? `
        <div class="sticker">
          <div class="s-shop">${shop}</div>
          ${c2.price ? `<div class="s-price">${cur} ${parseFloat(c2.price).toFixed(2)}</div>` : `<div class="s-price">&nbsp;</div>`}
          <svg id="sr${i + 1}"></svg>
          <div class="s-num">${c2.code}</div>
        </div>` : '<div class="sticker empty"></div>';

          rows += `<div class="sticker-row">${lbl1}${lbl2}</div>`;
        }

        const inits = codes.map((item, idx) => {
          if (!item) return '';
          const safe = item.code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          return `try{JsBarcode('#sr${idx}','${safe}',{format:'CODE128',width:1.3,height:24,displayValue:false,margin:0,background:'#fff',lineColor:'#000'});}catch(e){}`;
        }).join('');

        const pw = window.open('', '_blank', 'width=600,height=800');
        if (!pw) { toast('Pop-up blocked.', 'error'); return; }
        pw.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Barcodes Roll — ${shop}</title>
<script src="vendor/JsBarcode.all.min.js"><\/script>
<style>
  @page{size: 80mm auto; margin:0;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#fff; width: 80mm;}
  .sticker-row {
    display: flex;
    width: 80mm;
    height: 25mm; /* 22mm sticker + 3mm gap */
    overflow: hidden;
    page-break-inside: avoid;
  }
  .sticker {
    width: 40mm;
    height: 22mm;
    margin-bottom: 3mm; /* Gap area */
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    text-align:center;
    padding: 0 1.5mm;
  }
  .sticker.empty { visibility: hidden; }
  .s-shop { font-size: 6.5pt; font-weight: bold; margin-bottom: 0.3mm; color:#222; line-height: 1; }
  .s-price { font-size: 7.5pt; font-weight: 900; margin-bottom: 0.3mm; color:#000; line-height: 1; }
  svg { width: 100%; max-width: 34mm; height: auto; max-height: 9mm; display: block; }
  .s-num { font-family:'Courier New',monospace; font-size: 6pt; font-weight: bold; margin-top: 0.3mm; line-height: 1; }
  @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact; body { width: 80mm; }}}
/* PATTERN LOCK */
.pattern-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; width: 180px; margin: 10px auto; position: relative; touch-action: none; user-select: none; }
.pattern-dot { width: 45px; height: 45px; border-radius: 50%; background: var(--bg3); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 16px; user-select: none; cursor: pointer; transition: 0.2s; }
.pattern-dot.active { background: var(--cyan); border-color: var(--cyan); color: #000; box-shadow: 0 0 10px var(--cyan); }
</style>
</head>
<body>
${rows}
<script>
window.onload=function(){
  ${inits}
  setTimeout(function(){window.print();},1000);
};
<\/script>
</body></html>`);
        pw.document.close();
        toast(`🖨️ Printing ${codes.length} labels (2 Cols)...`, 'success');
      },

      doPrint() {
        const codes = this._getSelectedCodes();
        if (!codes.length) { toast('First generate barcodes, then print.', 'error'); return; }
        if (codes.length > 40) { toast('Max 40 per A4 sheet.', 'error'); return; }

        const labels = [...codes];
        while (labels.length < 40) labels.push(null);

        const shop = esc(S.settings.shopName);
        const cur = S.settings.currency;

        const cells = labels.map((item, idx) => {
          if (!item) return `<div class="label empty"></div>`;
          return `<div class="label">
        <div class="lshop">${shop}</div>
        ${item.price ? `<div class="lprice">${cur} ${parseFloat(item.price).toFixed(2)}</div>` : `<div class="lprice">&nbsp;</div>`}
        <svg id="s${idx}"></svg>
        <div class="lnum">${item.code}</div>
      </div>`;
        }).join('');

        const inits = labels.map((item, idx) => {
          if (!item) return '';
          const safe = item.code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          return `try{JsBarcode('#s${idx}','${safe}',{format:'CODE128',width:1.3,height:32,displayValue:false,margin:0,background:'#fff',lineColor:'#000'});}catch(e){}`;
        }).join('');

        const pw = window.open('', '_blank', 'width=1050,height=820');
        if (!pw) { toast('Pop-up blocked. Allow pop-ups and retry.', 'error'); return; }
        pw.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Barcodes — ${shop}</title>
<script src="vendor/JsBarcode.all.min.js"><\/script>
<style>
  @page{size:A4 portrait;margin:5mm 6mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#fff;}
  .hdr{text-align:center;font-size:8pt;color:#555;margin-bottom:3mm;}
  .grid{
    display:grid;
    grid-template-columns:repeat(5,1fr);
    grid-template-rows:repeat(8,33.5mm);
    gap:1.5mm;width:100%;
  }
  .label{
    border:0.5px solid #bbb;
    padding:1.5mm;
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    text-align:center;overflow:hidden;
  }
  .label.empty{border:0.5px dashed #ddd;background:#f9f9f9;}
  .lshop { font-size: 6pt; font-weight: bold; margin-bottom: 0.5mm; color:#222; }
  .lprice { font-size: 8pt; font-weight: 900; margin-bottom: 0.5mm; color:#000; }
  svg{width:100%;height:auto;display:block;max-height:22mm;}
  .lnum{font-family:'Courier New',monospace;font-size:5.5pt;color:#333;margin-top:1mm;letter-spacing:0.5px;}
  @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
/* PATTERN LOCK */
.pattern-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; width: 180px; margin: 10px auto; position: relative; touch-action: none; user-select: none; }
.pattern-dot { width: 45px; height: 45px; border-radius: 50%; background: var(--bg3); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 16px; user-select: none; cursor: pointer; transition: 0.2s; }
.pattern-dot.active { background: var(--cyan); border-color: var(--cyan); color: #000; box-shadow: 0 0 10px var(--cyan); }
</style>
</head>
<body>
<div class="hdr">${shop} &nbsp;•&nbsp; ${codes.length} barcode stickers &nbsp;•&nbsp; ${new Date().toLocaleDateString()}</div>
<div class="grid">${cells}</div>
<script>
window.onload=function(){
  ${inits}
  setTimeout(function(){window.print();},1000);
};
<\/script>
</body></html>`);
        pw.document.close();
        toast(`🖨️ Printing ${codes.length} barcode stickers...`, 'success');
      }
    };
