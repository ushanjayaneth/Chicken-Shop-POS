/* Inventory quantities remain in each product's canonical unit. */
const InventoryRules = {
  batches(value) { return Object.values(value || {}).filter(Boolean).map(batch => ({...batch, quantity: Number(batch.quantity) || 0})); },
  number(id, label, {fallback = 0, positive = false, integer = false, maximum = Infinity} = {}) {
    const text = document.getElementById(id)?.value.trim() || '';
    const value = text === '' ? fallback : Number(text);
    if (!Number.isFinite(value) || value < 0 || (positive && value <= 0) || (integer && !Number.isInteger(value)) || value > maximum) throw new Error('Enter a valid ' + label + '.');
    return value;
  },
  barcodes(item) {
    return [...String(item.barcode || '').split(',').map(value => value.trim()).filter(Boolean), ...this.batches(item.stockBatches).flatMap(batch => batch.barcodes || [])];
  },
  validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && localBusinessDate(new Date(value + 'T12:00:00+05:30')) === value; },
  adjust(batches, quantity, cost) {
    const stock = this.batches(batches);
    const current = stock.reduce((sum, batch) => sum + batch.quantity, 0);
    let difference = Math.round((quantity - current) * 1e6) / 1e6;
    if (difference > 0) stock.push({batchId: DB.newId(), quantity: difference, costPrice: cost, dateAdded: localBusinessDate(), adjustment: true});
    if (difference < 0) for (const batch of stock) {
      const used = Math.min(batch.quantity, -difference);
      if (batch.barcodes?.length && used > 0) throw new Error('Serial-numbered stock must be adjusted through its individual stock record.');
      batch.quantity = Math.round((batch.quantity - used) * 1e6) / 1e6;
      difference += used;
      if (difference >= -.000001) break;
    }
    return stock;
  }
};

    const InvTable = {
      render() {
        const tbody = document.getElementById('invBody'); if (!tbody) return;
        const q = document.getElementById('invSearch')?.value.trim().toLowerCase();
        const cur = S.settings.currency; let items = [...S.items];
        if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.barcode?.toLowerCase().includes(q) || S.categories.find(c => c.id === i.categoryId)?.name?.toLowerCase().includes(q));
        if (!items.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--t3)">No products found ➕</td></tr>`; return; }
        tbody.innerHTML = items.map(item => {
          const stock = getStock(item); const thresh = Number(item.lowStockThreshold ?? S.settings.lowStockAlert ?? 5);
          const isLow = stock <= thresh; const isOut = stock <= 0;
          const cat = S.categories.find(c => c.id === item.categoryId)?.name || '—';
          const pct = Math.min(100, (stock / Math.max(thresh * 3, 1)) * 100);
          const bc = isOut ? 'var(--red)' : isLow ? 'var(--orange)' : 'var(--green)';
          const tl = { weighted: '⚖️ Weighted', liquid: '🫙 Liquid', unit: '📦 Unit' }[item.type] || '📦 Unit';
          const bat = InventoryRules.batches(item.stockBatches).filter(b => b.quantity > 0).length;
          const photo = SaleAccounting.photo(item);
          const thumb = photo ? `<div class="item-thumb"><img src="${esc(photo)}" alt=""></div>` : `<div class="item-thumb">${getCatEmoji(item.categoryId)}</div>`;
          return `<tr><td><div class="flex items-center gap-8">${thumb}<div><div style="font-weight:700">${esc(item.name)}</div>${item.barcode ? `<div style="font-size:10px;color:var(--t3);font-family:'JetBrains Mono',monospace">${esc(item.barcode)}</div>` : ''}</div></div></td><td data-label="Category"><span class="badge badge-cyan">${esc(cat)}</span></td><td data-label="Type" style="font-size:12px">${tl}</td><td data-label="Price"><span class="mono text-cyan">${cur} ${Number(item.price || 0).toFixed(2)}</span></td><td data-label="Cost">${S.adminUnlocked ? `<span class="mono" style="color:var(--t2)">${cur} ${Number(item.costPrice || 0).toFixed(2)}</span>` : '<span style="filter:blur(5px);font-size:11px;color:var(--t3)">🔐 Admin</span>'}</td><td data-label="Stock"><div style="font-weight:700">${stock.toFixed(item.type === 'unit' ? 0 : 3)} <span style="color:var(--t3);font-size:10px">${item.unit || ''}</span></div><div class="stock-bar"><div class="stock-bar-inner" style="width:${pct}%;background:${bc}"></div></div><div style="font-size:10px;color:var(--t3);margin-top:2px">${bat} batch</div></td><td data-label="Status">${isOut ? '<span class="badge badge-red">Out</span>' : isLow ? '<span class="badge badge-orange">Low</span>' : '<span class="badge badge-green">In Stock</span>'}</td><td data-label="Actions"><div class="flex gap-6"><button class="btn btn-ghost btn-xs" title="Edit product" aria-label="Edit product" onclick="ItemForm.open('${item.id}')">✏️</button><button class="btn btn-success btn-xs" title="Add stock" aria-label="Add stock" onclick="StockAdd.open('${item.id}')">+📦</button><button class="btn btn-danger btn-xs" title="Delete product" aria-label="Delete product" onclick="Items.del('${item.id}')">🗑️</button></div></td></tr>`;
        }).join('');
      }
    };

    const Items = {
      async del(id) {
        if (!confirm('Delete this product? Previous bills will remain in sales history.')) return;
        if (S.cart.some(line => line.itemId === id)) { toast('Remove this product from the current cart before deleting it.', 'error'); return; }
        try { await DB.del('items/' + id); await loadAll(); toast('Product deleted', 'success'); }
        catch (error) { toast(error.message || 'The product could not be deleted.', 'error'); }
      }
    };

    const StockAdd = {
      scannedBarcodes: [],
      _saving: false,
      _itemId: null,
      isScanning: false,
      open(id) {
        this._itemId = id;
        this.scannedBarcodes = [];
        this.isScanning = false;
        const item = S.items.find(i => i.id === id); if (!item) return; const cur = S.settings.currency;
        document.getElementById('discTitle').textContent = `📦 Add Stock — ${item.name}`;
        document.getElementById('discBody').innerHTML = `
      <div class="form-group">
        <label>Qty (${item.unit})</label>
        <div style="display:flex;gap:8px;">
          <input type="number" id="saQ" placeholder="10" min="${item.type === 'unit' ? 1 : .001}" step="${item.type === 'unit' ? 1 : .001}" style="flex:1" autofocus inputmode="decimal">
          <button id="saScanBtn" class="btn btn-ghost btn-sm" style="border:1px solid var(--border);" onclick="StockAdd.toggleScanner()">📷 Scan Barcodes</button>
          <button id="saCamBtn" class="btn btn-ghost btn-sm" style="border:1px solid var(--border);" onclick="Scanner.openStockAdd()" title="Use Camera">📱 Camera</button>
        </div>
      </div>
      <div id="saBcWrap" style="display:none; margin-bottom:12px; font-size:11px; color:var(--cyan); border:1px dashed var(--border); padding:8px; border-radius:4px;">
         <div style="margin-bottom:4px; font-weight:bold;">Scanner Active (Scanned: <span id="saBcCount">0</span>)</div>
         <div id="saBcList" style="max-height:60px; overflow-y:auto; color:var(--t2);"></div>
      </div>
      <div class="form-group"><label>Cost Price (${cur}/${item.unit})</label><input type="number" id="saC" value="${item.costPrice || ''}" placeholder="0.00" min="0" step="0.01" inputmode="decimal"></div><div class="form-group"><label>Date Received</label><input type="date" id="saD" value="${localBusinessDate()}"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="StockAdd.close()">Cancel</button><button class="btn btn-primary" onclick="StockAdd.confirm('${id}')">➕ Add Stock</button></div>`;
        Modal.open('discModal');
        if (item.type !== 'unit') {
          document.getElementById('saScanBtn').style.display = 'none';
          document.getElementById('saCamBtn').style.display = 'none';
        }
        const saQEl = document.getElementById('saQ');
        if (saQEl) saQEl.focus();
      },
      toggleScanner() {
        const item = S.items.find(product => product.id === this._itemId);
        if (item?.type !== 'unit') { toast('Barcode stock intake is available for whole unit products.', 'info'); return; }
        this.isScanning = !this.isScanning;
        document.getElementById('saBcWrap').style.display = this.isScanning ? 'block' : 'none';
        const btn = document.getElementById('saScanBtn');
        const camBtn = document.getElementById('saCamBtn');
        if (this.isScanning) {
          btn.textContent = '⏹ Stop Scan';
          btn.className = 'btn btn-danger btn-sm';
          camBtn.style.display = 'none';
          document.getElementById('saQ').readOnly = true;
          if (this.scannedBarcodes.length === 0) document.getElementById('saQ').value = 0;
          document.activeElement?.blur();
        } else {
          btn.textContent = '📷 Scan Barcodes';
          btn.className = 'btn btn-ghost btn-sm';
          camBtn.style.display = 'inline-flex';
          document.getElementById('saQ').readOnly = false;
        }
      },
      handleScan(barcode) {
        barcode = String(barcode || '').trim();
        if (!barcode) return;
        const item = S.items.find(product => product.id === this._itemId);
        if (item?.type !== 'unit') { toast('Use a measured quantity for weighted or liquid stock.', 'error'); return; }
        if (S.items.some(product => InventoryRules.batches(product.stockBatches).some(batch => (batch.barcodes || []).includes(barcode)))) { toast('This serial barcode is already in stock.', 'error'); return; }
        if (!this.scannedBarcodes.includes(barcode)) {
          this.scannedBarcodes.push(barcode);
          document.getElementById('saQ').value = this.scannedBarcodes.length;
          document.getElementById('saBcCount').textContent = this.scannedBarcodes.length;
          const list = document.getElementById('saBcList');
          list.innerHTML += `<div>✔️ ${esc(barcode)}</div>`;
          list.scrollTop = list.scrollHeight;
        } else {
          toast('Already scanned!', 'error');
        }
      },
      close() {
        this.isScanning = false;
        Modal.close('discModal');
      },
      async confirm(id) {
        if (this._saving) return false;
        this._saving = true;
        try {
          const item = await DB.get('items/' + id);
          if (!item) throw new Error('This product is no longer available.');
          const qty = InventoryRules.number('saQ', 'stock quantity', {positive: true, integer: item.type === 'unit'});
          const cost = InventoryRules.number('saC', 'cost price');
          const date = document.getElementById('saD').value;
          if (!InventoryRules.validDate(date)) throw new Error('Choose a valid date received.');
          if (this.scannedBarcodes.length && this.scannedBarcodes.length !== qty) throw new Error('The quantity must match the number of scanned serial barcodes.');
          const products = Object.values(await DB.get('items') || {});
          const duplicate = this.scannedBarcodes.some(code => products.some(product => InventoryRules.batches(product.stockBatches).some(batch => (batch.barcodes || []).includes(code))));
          if (duplicate) throw new Error('A scanned serial barcode is already in stock.');
          const batch = {batchId: DB.newId(), quantity: qty, costPrice: cost, dateAdded: date};
          if (this.scannedBarcodes.length) batch.barcodes = [...this.scannedBarcodes];
          await DB.batch([{type: 'patch', path: 'items/' + id, data: {stockBatches: [...InventoryRules.batches(item.stockBatches), batch]}, expected: {stockBatches: item.stockBatches || []}}]);
          await loadAll();
          toast('Stock added: ' + qty + ' ' + item.unit, 'success');
          this.close();
          return true;
        } catch (error) { toast(error.message || 'Stock could not be saved. Please try again.', 'error'); return false; }
        finally { this._saving = false; }
      }
    };

    // ── ITEM FORM ───────────────────────────
    const ItemForm = {
      _tempImageDataUrl: null,
      _imageProcessing: false,
      _editingSnapshot: null,
      _originalStock: 0,
      _saving: false,
      open(id) {
        this._tempImageDataUrl = null;
        const item = id ? S.items.find(i => i.id === id) : null;
        this._editingSnapshot = item ? JSON.parse(JSON.stringify(item)) : null;
        this._originalStock = item ? getStock(item) : 0;
        document.getElementById('itemModalTitle').textContent = item ? '✏️ Edit Product' : '➕ Add New Product';
        document.getElementById('itemFormBody').innerHTML = this.getHTML(item);
        this.toggleType();
        if (item?.barcode) this.previewBarcode();
        if (item?.liquidOptions?.length) this.renderLiqOpts(item.liquidOptions);
        this.setupImageUpload(item);
        Modal.open('itemModal');
        const fName = document.getElementById('fName');
        if (fName) fName.focus();
      },
      getHTML(item) {
        const cur = S.settings.currency;
        const catOpts = S.categories.map(c => `<option value="${c.id}" ${item?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
        return `
      <div class="grid-2">
        <div class="form-group"><label>Product Name *</label><input id="fName" type="text" value="${esc(item?.name || '')}" placeholder="e.g. Fresh chicken breast" autofocus inputmode="text" autocomplete="off" autocapitalize="words"></div>
        <div class="form-group">
          <label>Barcode</label>
          <div style="position:relative;">
            <button type="button" style="position:absolute;left:0;top:0;bottom:0;width:34px;background:var(--glass2);border:none;border-right:1px solid var(--border2);border-radius:var(--r8) 0 0 var(--r8);cursor:pointer;color:var(--cyan);font-size:14px;display:flex;align-items:center;justify-content:center;z-index:1;" onclick="Scanner.openFormScan()" title="Scan barcode">📷</button>
            <input id="fBarcode" type="text" value="${esc(item?.barcode || '')}" placeholder="Scan or type barcode..." style="padding-left:38px;" oninput="ItemForm.previewBarcode()" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="none">
          </div>
          <div id="bcPreviewWrap" style="display:${item?.barcode ? 'block' : 'none'}">
            <div class="bc-preview" id="bcPreview"></div>
          </div>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Category</label><select id="fCat"><option value="">-- Select --</option>${catOpts}</select></div>
        <div class="form-group"><label>Item Type</label><select id="fType" onchange="ItemForm.toggleType()"><option value="unit" ${!item?.type || item?.type === 'unit' ? 'selected' : ''}>📦 Unit (pcs)</option><option value="weighted" ${item?.type === 'weighted' ? 'selected' : ''}>⚖️ Weighted (kg/g)</option><option value="liquid" ${item?.type === 'liquid' ? 'selected' : ''}>🫙 Liquid (L/ml)</option></select></div>
      </div>
      <div class="grid-4">
        <div class="form-group"><label>Retail Price (${cur})</label><input id="fPrice" type="number" value="${item?.price ?? ''}" placeholder="0.00" min="0" step="0.5" inputmode="decimal"></div>
        <div class="form-group">${S.adminUnlocked
            ? `<label>Cost Price (${cur}) 🔐</label><input id="fCost" type="number" value="${item?.costPrice ?? ''}" placeholder="0.00" min="0" step="0.5" inputmode="decimal">`
            : `<label style="color:var(--t3)">Cost Price</label><div style="padding:9px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r8);font-size:12px;color:var(--t3);display:flex;align-items:center;gap:5px;">🔐 Admin only<input type="hidden" id="fCost" value="${item?.costPrice || 0}"></div>`
          }</div>
        <div class="form-group"><label>Wholesale Price (${cur})</label><input id="fWholesale" type="number" value="${item?.wholesalePrice ?? ''}" placeholder="Same as retail" min="0" step="0.01" inputmode="decimal"></div>
        <div class="form-group"><label>Unit</label><input id="fUnit" type="text" value="${esc(item?.unit || 'pcs')}" placeholder="pcs / kg / L" inputmode="text"></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Low Stock Alert</label><input id="fThresh" type="number" value="${item?.lowStockThreshold ?? S.settings.lowStockAlert ?? 5}" min="0" inputmode="numeric"></div>
        <div class="form-group"><label>Default Discount (%)</label><input id="fDisc" type="number" value="${item?.defaultDiscount || 0}" min="0" max="100" inputmode="decimal"></div>
      </div>
      <div id="fWeightHint" style="display:none"><div class="info-hint">⚖️ Weighted: In POS you can enter by amount (Rs.) or weight (kg/g). Stock tracked by weight.</div></div>
      <div id="fLiquidFields" style="display:none">
        <div style="background:var(--purple2);border:1px solid rgba(139,92,246,0.25);border-radius:var(--r8);padding:14px;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:10px">🫙 Liquid Options (e.g. Quarter / Half / Full)</div>
          <div id="liqOptsList"></div>
          <button class="btn btn-ghost btn-sm mt-8" onclick="ItemForm.addLiqRow()">+ Add Option</button>
        </div>
      </div>
      ${!item ? '<div class="form-group"><label>Initial Stock Quantity</label><input id="fInitStock" type="number" value="0" min="0" step="0.001" inputmode="decimal"></div>' : S.adminUnlocked ? '<div class="grid-2"><div class="form-group"><label>Current Stock Count (' + esc(item.unit || 'pcs') + ')</label><input id="fStockCount" type="number" value="' + getStock(item) + '" min="0" step="0.001" inputmode="decimal"></div><div class="form-group"><label>Stock Adjustment Reason</label><input id="fStockReason" type="text" placeholder="Required when changing stock count"></div></div>' : ''}
      <div class="form-group">
        <label>Product Image</label>
        <div id="imageUploadArea" style="border:2px dashed var(--border);border-radius:var(--r8);padding:20px;text-align:center;cursor:pointer;transition:all 0.3s;position:relative;background:var(--bg2);">
          <input type="file" id="fImgFile" accept="image/*" style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2;">
          <div id="imageUploadMsg">
            <div style="font-size:24px;color:var(--t3);margin-bottom:8px;">🖼️</div>
            <div style="color:var(--t2);font-size:12px;">Click or Drag & Drop image here</div>
            <div style="color:var(--t3);font-size:10px;margin-top:4px;">Photos up to 900KB after automatic optimization</div>
          </div>
          <div id="imagePreviewContainer" style="display:none;position:relative;z-index:3;width:fit-content;margin:0 auto;">
            <img id="imagePreview" src="" style="max-height:120px;max-width:100%;border-radius:var(--r4);object-fit:contain;">
            <button type="button" class="btn btn-danger btn-xs" style="position:absolute;top:-10px;right:-10px;border-radius:50%;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.2);" onclick="event.preventDefault();ItemForm.removeImage()">✕</button>
          </div>
        </div>
      </div>
      <div class="form-group"><input type="file" id="fImgCamera" accept="image/*" capture="environment" style="display:none"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('fImgCamera').click()">Take photo</button></div>
      <div class="form-group"><label style="font-size:11px;color:var(--t3);">Or use Image URL (optional)</label><input id="fImg" type="text" value="${esc(item?.image || '')}" placeholder="https://..." inputmode="url" autocapitalize="none"></div>
      <div class="form-group"><label>Description</label><textarea id="fDesc" rows="2" inputmode="text">${esc(item?.description || '')}</textarea></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('itemModal')">Cancel</button>
        <button class="btn btn-primary" onclick="ItemForm.save(${item ? `'${item.id}'` : null})">💾 ${item ? 'Update' : 'Save'} Product</button>
      </div>`;
      },
      toggleType() {
        const t = document.getElementById('fType')?.value;
        const u = document.getElementById('fUnit');
        document.getElementById('fWeightHint').style.display = t === 'weighted' ? '' : 'none';
        document.getElementById('fLiquidFields').style.display = t === 'liquid' ? '' : 'none';
        if (u) { if (t === 'weighted' && u.value === 'pcs') u.value = 'kg'; if (t === 'liquid' && u.value === 'pcs') u.value = 'L'; if (t === 'unit' && (u.value === 'kg' || u.value === 'L')) u.value = 'pcs'; }
      },
      previewBarcode() {
        const code = document.getElementById('fBarcode')?.value.trim();
        const wrap = document.getElementById('bcPreviewWrap');
        const prev = document.getElementById('bcPreview');
        if (!code || !wrap || !prev) { if (wrap) wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        try {
          prev.innerHTML = '<svg id="bcSvg"></svg>';
          JsBarcode('#bcSvg', code, { format: 'CODE128', width: 1.8, height: 50, displayValue: true, fontSize: 11, margin: 4, background: '#ffffff', lineColor: '#000000' });
        } catch (e) { prev.innerHTML = `<div style="color:var(--red);font-size:11px;padding:5px">Invalid barcode: ${esc(e.message)}</div>`; }
      },
      addLiqRow(l = '', a = '', p = '') { const list = document.getElementById('liqOptsList'); const div = document.createElement('div'); div.className = 'flex gap-8 mb-8 items-center'; div.innerHTML = `<input class="lo-l" type="text" value="${esc(l)}" placeholder="Label" style="flex:1"><input class="lo-a" type="number" value="${a}" placeholder="Qty" style="width:70px" min="0.01" step="0.01"><input class="lo-p" type="number" value="${p}" placeholder="Price" style="width:80px" min="0" step="0.5"><button class="btn btn-danger btn-xs" onclick="this.closest('div').remove()">✕</button>`; list.appendChild(div); },
      renderLiqOpts(opts) { opts.forEach(o => this.addLiqRow(o.label, o.amount, o.price)); },
      getLiqOpts() {
        return Array.from(document.querySelectorAll('#liqOptsList .flex'))
          .map(row => ({
            label: row.querySelector('.lo-l').value.trim(),
            amountText: row.querySelector('.lo-a').value.trim(),
            priceText: row.querySelector('.lo-p').value.trim()
          }))
          .filter(row => row.label || row.amountText || row.priceText)
          .map(row => ({label: row.label, amount: Number(row.amountText), price: Number(row.priceText)}));
      },
      setupImageUpload(item) {
        const area = document.getElementById('imageUploadArea');
        const input = document.getElementById('fImgFile');
        const msg = document.getElementById('imageUploadMsg');
        const prevWrap = document.getElementById('imagePreviewContainer');
        const prevImg = document.getElementById('imagePreview');
        const urlInput = document.getElementById('fImg');
        const updatePreview = (src) => {
          if (src) { prevImg.src = src; msg.style.display = 'none'; prevWrap.style.display = 'block'; }
          else { prevImg.src = ''; msg.style.display = 'block'; prevWrap.style.display = 'none'; }
        };
        if (item?.image) updatePreview(item.image);
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evName => { area.addEventListener(evName, e => { e.preventDefault(); e.stopPropagation(); }); });
        area.addEventListener('dragover', () => area.style.borderColor = 'var(--cyan)');
        area.addEventListener('dragleave', () => area.style.borderColor = 'var(--border)');
        area.addEventListener('drop', (e) => {
          area.style.borderColor = 'var(--border)';
          if (e.dataTransfer.files && e.dataTransfer.files[0]) this.processImageFile(e.dataTransfer.files[0], updatePreview);
        });
        document.getElementById('fImgCamera').addEventListener('change', e => { if (e.target.files?.[0]) this.processImageFile(e.target.files[0], updatePreview); });
        input.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) this.processImageFile(e.target.files[0], updatePreview);
        });
        urlInput.addEventListener('input', (e) => {
          this._tempImageDataUrl = null;
          updatePreview(e.target.value.trim());
        });
      },
      async processImageFile(file, updatePreviewFn) {
        if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
        this._imageProcessing = true;
        try {
          const dataUrl = await this.compressImage(file);
          this._tempImageDataUrl = dataUrl;
          updatePreviewFn(dataUrl);
          document.getElementById('fImg').value = '';
        } catch (error) { toast(error.message || 'The image could not be processed.', 'error'); }
        finally { this._imageProcessing = false; }
      },
      compressImage(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('The selected image could not be read.'));
          reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Choose a supported JPEG, PNG or WebP image.'));
            img.onload = () => {
              if (file.size <= 900000 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { resolve(reader.result); return; }
              const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(img.width * scale));
              canvas.height = Math.max(1, Math.round(img.height * scale));
              const context = canvas.getContext('2d');
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(img, 0, 0, canvas.width, canvas.height);
              let result = '';
              for (let quality = .94; quality >= .54; quality -= .08) {
                result = canvas.toDataURL('image/jpeg', quality);
                if ((result.length - result.indexOf(',') - 1) * .75 <= 900000) { resolve(result); return; }
              }
              while (canvas.width > 400 && canvas.height > 400) {
                const smaller = document.createElement('canvas');
                smaller.width = Math.round(canvas.width * .8);
                smaller.height = Math.round(canvas.height * .8);
                smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
                canvas.width = smaller.width;
                canvas.height = smaller.height;
                canvas.getContext('2d').drawImage(smaller, 0, 0);
                result = canvas.toDataURL('image/jpeg', .86);
                if ((result.length - result.indexOf(',') - 1) * .75 <= 900000) { resolve(result); return; }
              }
              reject(new Error('The image could not be optimized. Choose a different photo.'));
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        });
      },
      removeImage() {
        this._tempImageDataUrl = null;
        document.getElementById('fImg').value = '';
        document.getElementById('fImgFile').value = '';
        document.getElementById('fImgCamera').value = '';
        document.getElementById('imagePreview').removeAttribute('src');
        document.getElementById('imageUploadMsg').style.display = 'block';
        document.getElementById('imagePreviewContainer').style.display = 'none';
      },
      async save(id) {
        if (this._saving) return false;
        if (this._imageProcessing) { toast('Please wait while the photo is optimized.', 'info'); return false; }
        this._saving = true;
        try {
          const current = id ? await DB.get('items/' + id) : null;
          if (id && !current) throw new Error('This product is no longer available.');
          const name = document.getElementById('fName').value.trim();
          if (!name) throw new Error('Enter a product name.');
          const type = document.getElementById('fType').value;
          const unit = document.getElementById('fUnit').value.trim() || (type === 'weighted' ? 'kg' : type === 'liquid' ? 'L' : 'pcs');
          if (!['unit','weighted','liquid'].includes(type)) throw new Error('Choose a valid product type.');
          if (current && getStock(current) > 0 && ((current.type || 'unit') !== type || (current.unit || 'pcs') !== unit)) throw new Error('Set the current stock to zero before changing its type or unit.');
          const price = InventoryRules.number('fPrice', 'retail price', {positive: true});
          const wholesaleText = document.getElementById('fWholesale').value.trim();
          const wholesalePrice = wholesaleText === '' ? null : InventoryRules.number('fWholesale', 'wholesale price', {positive: true});
          const costPrice = S.adminUnlocked ? InventoryRules.number('fCost', 'cost price') : Number(current?.costPrice || 0);
          const costEstimated = S.adminUnlocked ? document.getElementById('fCost').value.trim() === '' : current?.costEstimated ?? !current;
          const lowStockThreshold = InventoryRules.number('fThresh', 'low stock threshold', {fallback: Number(S.settings.lowStockAlert ?? 5)});
          const defaultDiscount = InventoryRules.number('fDisc', 'default discount', {maximum: 100});
          const barcode = document.getElementById('fBarcode').value.trim() || null;
          const products = Object.entries(await DB.get('items') || {});
          const codes = String(barcode || '').split(',').map(code => code.trim()).filter(Boolean);
          if (new Set(codes).size !== codes.length || products.some(([productId, product]) => productId !== id && InventoryRules.barcodes(product).some(code => codes.includes(code)))) throw new Error('This barcode is already assigned to another product.');
          const image = this._tempImageDataUrl || document.getElementById('fImg').value.trim() || null;
          if (image && !/^https?:\/\//i.test(image) && !/^data:image\/(jpeg|png|webp);base64,/i.test(image)) throw new Error('Enter a valid image URL or choose a photo.');
          const liquidOptions = type === 'liquid' ? this.getLiqOpts() : null;
          if (liquidOptions?.some(option => !option.label || !Number.isFinite(option.amount) || option.amount <= 0 || !Number.isFinite(option.price) || option.price <= 0)) throw new Error('Each liquid option needs a positive quantity and price.');
          const data = {name, type, barcode, categoryId: document.getElementById('fCat').value || null, price, wholesalePrice, costPrice, costEstimated, unit, lowStockThreshold, defaultDiscount, image, description: document.getElementById('fDesc').value.trim() || null, liquidOptions, updatedAt: new Date().toISOString()};
          if (!id) {
            const quantity = InventoryRules.number('fInitStock', 'initial stock quantity', {integer: type === 'unit'});
            data.createdAt = data.updatedAt;
            data.stockBatches = quantity ? [{batchId: DB.newId(), quantity, costPrice, dateAdded: localBusinessDate()}] : [];
            await DB.push('items', data);
          } else {
            const opened = this._editingSnapshot || current;
            const expected = {updatedAt: opened.updatedAt ?? null, name: opened.name ?? null, price: opened.price ?? null, costPrice: opened.costPrice ?? null, type: opened.type ?? null, unit: opened.unit ?? null};
            const operations = [{type:'patch', path:'items/' + id, data, expected}];
            if (S.adminUnlocked && document.getElementById('fStockCount')) {
              const quantity = InventoryRules.number('fStockCount', 'stock count', {integer: type === 'unit'});
              if (Math.abs(quantity - this._originalStock) > .000001) {
                if (Math.abs(getStock(current) - this._originalStock) > .000001) throw new Error('The stock changed while this form was open. Reopen it and review the stock count.');
                const reason = document.getElementById('fStockReason').value.trim();
                if (!reason) throw new Error('Enter the reason for this stock adjustment.');
                const adjustment = {id: DB.newId(), from: getStock(current), to: quantity, reason, date: data.updatedAt};
                operations.push({type:'patch', path:'items/' + id, data:{stockBatches:InventoryRules.adjust(current.stockBatches,quantity,costPrice),stockAdjustments:[...Object.values(current.stockAdjustments || {}),adjustment]},expected:{stockBatches:current.stockBatches || []}});
              }
            }
            await DB.batch(operations);
          }
          Modal.close('itemModal');
          await loadAll();
          toast(id ? 'Product updated' : 'Product added', 'success');
          return true;
        } catch (error) { toast(error.message || 'The product could not be saved.', 'error'); return false; }
        finally { this._saving = false; }
      }
    };
