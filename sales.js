// Shared calculations keep displayed totals and committed financial records aligned.
const SaleAccounting = {
  money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
  },
  discount(base, value, type) {
    const amount = Number(value);
    const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    return this.money(Math.min(Math.max(0, base), type === 'percent' ? base * Math.min(100, safe) / 100 : safe));
  },
  lineNet(line) {
    const price = this.money(Math.max(0, Number(line.price) || 0));
    return this.money(price - this.discount(price, line.discount, line.discType));
  },
  totals(cart, value = S.cartDisc, type = S.cartDiscType) {
    const subtotal = this.money(cart.filter(line=>!line.isExchangeCredit).reduce((sum, line) => sum + this.lineNet(line), 0));
    const cartDiscount = this.discount(subtotal, value, type);
    const saleTotal = this.money(subtotal - cartDiscount);
    const credits = ExchangeCredits.plan(cart, saleTotal);
    const creditApplied = this.money(credits.reduce((sum, credit) => sum + credit.amount, 0));
    return {subtotal,cartDiscount,saleTotal,credits,creditApplied,total:this.money(saleTotal-creditApplied)};
  },
  posDay(date) {
    const daySales = S.sales.filter(sale => sale.date && localBusinessDate(sale.date) === date && !['void','cancelled'].includes(sale.status));
    const totalRev = this.money(daySales.reduce((sum,sale) => sum + Number(sale.total || 0),0));
    const totalTxns = daySales.length;
    const settlement = method => this.money(daySales.filter(sale => (sale.payMethod || 'cash') === method).reduce((sum,sale) => sum + this.settledAmount(sale),0));
    const posCashIn = settlement('cash'), posCardIn = settlement('card'), posOnlineIn = settlement('online');
    const loanPaymentsIn = this.money(S.loans.reduce((sum,loan) => sum + (loan.paymentHistory || []).filter(payment => localBusinessDate(payment.date) === date && (!payment.method || payment.method === 'cash')).reduce((subtotal,payment) => subtotal + Number(payment.amount || 0),0),0));
    const dayMovements = S.cash_movements.filter(move => move.date && localBusinessDate(move.date) === date);
    const movement = type => this.money(dayMovements.filter(move => move.type === type && move.source === 'manual').reduce((sum,move) => sum + Number(move.amount || 0),0));
    const manualCashIn = movement('in'), manualCashOut = movement('out');
    const savedFloat = Number(S.settings.openingFloats?.[date]) || 0;
    return {daySales,totalRev,totalTxns,totalItems:daySales.reduce((sum,sale)=>sum+(sale.items||[]).length,0),avgTxn:totalTxns?totalRev/totalTxns:0,posCashIn,posCardIn,posOnlineIn,loanPaymentsIn,dayMovements,manualCashIn,manualCashOut,savedFloat,expectedCash:this.money(savedFloat+posCashIn+loanPaymentsIn+manualCashIn-manualCashOut)};
  },
  settledAmount(sale) {return sale.payMethod === 'exchange' ? 0 : this.money(Number(sale.total || 0) - Number(sale.exchangeCreditAmount || 0));},
  photo(item) {
    if (item.image) return item.image;
    const category = S.categories.find(category => category.id === item.categoryId)?.name || '';
    const name = (String(item.name) + ' ' + category).toLowerCase();
    if (/egg|බිත්තර/.test(name)) return 'assets/images/eggs.jpg';
    if (/fish|tuna|seafood|මාළු|මාලු/.test(name)) return 'assets/images/fish.jpg';
    if (/breast|fillet/.test(name)) return 'assets/images/breast.jpg';
    if (/chicken|poultry|කුකු/.test(name)) return 'assets/images/chicken.jpg';
    return '';
  },
  isCustom(line) {
    return line.isCustom === true || String(line.itemId || '').startsWith('CUSTOM_');
  },
  batches(value) { return JSON.parse(JSON.stringify(Object.values(value || {}).filter(batch => batch && typeof batch === 'object'))); },
  stockPlan(cart) {
    const products = new Map();
    const costs = [];
    for (const line of cart) {
      const quantity = Number(line.qty);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a valid quantity for ' + line.name);
      if (!Number.isFinite(Number(line.price)) || Number(line.price) < 0) throw new Error('Enter a valid price for ' + line.name);
      if (this.isCustom(line)) {
        costs.push(this.money(quantity * Math.max(0, Number(line.costPrice) || 0)));
        continue;
      }
      const item = S.items.find(product => product.id === line.itemId);
      if (!item) throw new Error((line.name || 'Product') + ' is no longer available');
      if (item.type !== 'weighted' && item.type !== 'liquid' && !Number.isInteger(quantity)) throw new Error(item.name + ' requires a whole quantity');
      let entry = products.get(item.id);
      if (!entry) {
        entry = { item, original: JSON.parse(JSON.stringify(item.stockBatches || [])), batches: this.batches(item.stockBatches) };
        products.set(item.id, entry);
      }
      let remaining = quantity;
      let cost = 0;
      const serial = line.serialCode || (POS.batchHasBarcode(item, line.label) ? line.label : null);
      const batches = serial ? entry.batches.filter(batch => Object.values(batch.barcodes || {}).includes(serial)) : entry.batches;
      if (serial && quantity !== 1) throw new Error('Scan each serialized product separately');
      for (const batch of batches) {
        const available = Math.max(0, Number(batch.quantity) || 0);
        const used = Math.min(available, remaining);
        if (used <= 0) continue;
        const unitCost = batch.costPrice == null ? Number(item.costPrice) || 0 : Math.max(0, Number(batch.costPrice) || 0);
        cost += used * unitCost;
        batch.quantity = Math.max(0, Math.round((available - used) * 1000000) / 1000000);
        remaining = Math.max(0, remaining - used);
        if (serial) batch.barcodes = Object.values(batch.barcodes || {}).filter(code => code !== serial);
        if (remaining < 0.0000001) break;
      }
      if (remaining > 0.0000001) throw new Error('Insufficient stock for ' + item.name);
      costs.push(this.money(cost));
    }
    return { products, costs, operations: Array.from(products.values(), entry => ({ type: 'patch', path: 'items/' + entry.item.id, data: { stockBatches: entry.batches }, expected: { stockBatches: entry.original } })) };
  },
  applyStock(plan) {
    for (const entry of plan.products.values()) entry.item.stockBatches = entry.batches;
  },
  netAmounts(sale) {
    const items = sale.items || [];
    const subtotal = this.money(items.reduce((sum, line) => sum + Math.max(0, Number(line.price) || 0), 0));
    const total = Math.min(subtotal, Math.max(0, Number(sale.total) || 0));
    let cumulative = 0;
    let allocated = 0;
    return items.map(line => {
      cumulative += Math.max(0, Number(line.price) || 0);
      const next = subtotal > 0 ? this.money(total * cumulative / subtotal) : 0;
      const amount = this.money(next - allocated);
      allocated = next;
      return amount;
    });
  }
};

// Sales, inventory allocation, customer loans, and returns.

    const POS = {
      toggleCartView(show, updateHistory = true) {
        const panel = document.getElementById('posTab');
        if (!panel || panel.classList.contains('show-cart') === show) return;
        panel.classList.toggle('show-cart', show);
        if (!updateHistory) return;
        if (show) history.pushState({type: 'cart', tab: 'pos'}, '');
        else if (history.state?.type === 'cart') history.replaceState({type: 'tab', tab: 'pos'}, '');
      },
      currentMode: 'retail',
      restoreMode(mode) {
        this.currentMode = ['retail', 'wholesale', 'loan'].includes(mode) ? mode : 'retail';
        const ids = { retail: 'gModeRetail', wholesale: 'gModeWholesale', loan: 'gModeLoan' };
        for (const k in ids) {
          const el = document.getElementById(ids[k]);
          if (el) el.className = 'btn btn-sm ' + (this.currentMode === k ? 'active' : 'btn-ghost');
        }
      },
      setMode(mode) {
        this.restoreMode(mode);
        // Apply new mode to all existing cart items
        S.cart.forEach((_, i) => Cart.setSaleMode(i, mode, true));
        Cart.render();
        const ml = { retail: '🏪 Retail', loan: '💳 Loan' };
        toast('Mode: ' + (ml[mode] || mode), 'info');
      },
      renderCats() { const bar = document.getElementById('catBar'); if (!bar) return; const cur = S.activeCat; let h = `<div class="cat-chip ${cur === 'all' ? 'active' : ''}" onclick="POS.setCat('all')">🌐 All</div>`; S.categories.forEach(c => { h += `<div class="cat-chip ${cur === c.id ? 'active' : ''}" onclick="POS.setCat('${c.id}')">${esc(c.name)}</div>`; }); h += `<div class="cat-chip cat-chip-add" id="addCatChip">+ Category</div>`; bar.innerHTML = h; bar.querySelector('#addCatChip').onclick = async () => { const n = prompt('New category:'); if (n) await Cats.add(n); }; },
      setCat(id) { S.activeCat = id; this.renderCats(); this.renderGrid(); },
      filter() { this.renderGrid(); },
      getItems() { let items = [...S.items]; if (S.activeCat !== 'all') items = items.filter(i => i.categoryId === S.activeCat); const q = document.getElementById('posSearch')?.value.trim(); if (q) { const f = new Fuse(items, { keys: ['name', 'barcode', 'description'], threshold: 0.4 }); items = f.search(q).map(r => r.item); } return items; },
      renderGrid() {
        const grid = document.getElementById('itemGrid'); if (!grid) return;
        const items = this.getItems();
        if (!items.length) { grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div>No products found</div></div>`; return; }
        const cur = S.settings.currency;
        grid.innerHTML = items.map(item => {
          const stock = getStock(item); const isOut = stock <= 0; const isLow = stock > 0 && stock <= (item.lowStockThreshold ?? S.settings.lowStockAlert);
          const ce = getCatEmoji(item.categoryId);
          const photo = SaleAccounting.photo(item);
          const img = photo ? `<div class="item-img-wrap"><img src="${esc(photo)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='${ce}'"></div>` : `<div class="item-emoji">${ce}</div>`;
          const badge = isOut ? `<span class="badge badge-red">Out</span>` : isLow ? `<span class="badge badge-orange">Low</span>` : `<span class="badge badge-green">✓</span>`;
          const st = (item.unit === 'kg' || item.unit === 'L') ? stock.toFixed(3) : Math.floor(stock);
          const wsP = item.wholesalePrice ? `<div class="item-card-ws">W: ${cur} ${parseFloat(item.wholesalePrice).toFixed(2)}</div>` : '';
          return `<div class="item-card ${isOut ? 'out-stock' : isLow ? 'low-stock' : ''}" onclick="POS.addFlow('${item.id}')">${img}<div class="item-card-name">${esc(item.name)}</div><div class="item-card-price">${cur} ${(item.price || 0).toFixed(2)}<span style="font-size:9px;color:var(--t3)"> /${item.unit || 'u'}</span></div>${wsP}<div class="item-card-meta">${badge}<span class="item-card-stock mono">${st} ${item.unit || ''}</span></div></div>`;
        }).join('');
      },
      addFlow(itemId) {
        const item = S.items.find(i => i.id === itemId);
        if (!item || getStock(item) <= 0) { toast('Out of stock!', 'error'); return; }
        if (item.type === 'weighted') { this.showWeightedModal(item); }
        else if (item.type === 'liquid' && item.liquidOptions?.length) { this.showLiquidModal(item); }
        else { this.showSaleTypePicker(item, 1); }
      },
      showSaleTypePicker(item, qty, label = null, fixedPrice = null) {
        // Instead of showing the modal, directly confirm the sale using current global mode.
        this.confirmSale(item.id, qty, this.currentMode, label, fixedPrice);
      },
      confirmSale(itemId, qty, mode, label, fp) {
        const item = S.items.find(i => i.id === itemId); if (!item) return;
        Cart.add(item, qty, label || null, fp !== null && fp !== 'null' ? parseFloat(fp) : null, mode);
        Modal.close('saleTypeModal');
      },
      showWeightedModal(item) {
        const cur = S.settings.currency;
        const unitPrice = this.unitPrice(item);
        document.getElementById('optContent').innerHTML = `
      <div class="modal-head"><div class="modal-title">⚖️ ${esc(item.name)}</div><button class="modal-x" onclick="Modal.close('optModal')">✕</button></div>
      <div class="opt-tabs"><div class="opt-tab active" id="wt1" onclick="POS.wTab(1)">💰 By Amount (${cur})</div><div class="opt-tab" id="wt2" onclick="POS.wTab(2)">⚖️ By ${item.unit === 'kg' ? 'Kg' : 'Qty'}</div></div>
      <div id="wBody1">
        <div class="form-group"><label>Customer pays (${cur})</label><input type="number" id="wAmt" placeholder="100.00" min="0" step="0.5" autofocus inputmode="decimal"></div>
        <p style="font-size:11px;color:var(--t2);margin-bottom:12px">${cur} ${unitPrice.toFixed(2)} / ${item.unit} — weight auto calculated</p>
        <button class="btn btn-primary w-full" onclick="POS.confirmWAmt('${item.id}')">Next →</button>
      </div>
      <div id="wBody2" style="display:none">
        <div class="form-group"><label>${item.unit === 'kg' ? 'Weight (kg)' : 'Quantity'}</label><input type="number" id="wQty" placeholder="1.0" min="0.001" step="0.001" inputmode="decimal"></div>
        <button class="btn btn-primary w-full" onclick="POS.confirmWQty('${item.id}')">Next →</button>
      </div>`;
        Modal.open('optModal');
        const el = document.getElementById('wAmt');
        if (el) el.focus();
      },
      wTab(n) {
        document.getElementById('wt1').classList.toggle('active', n === 1);
        document.getElementById('wt2').classList.toggle('active', n === 2);
        document.getElementById('wBody1').style.display = n === 1 ? '' : 'none';
        document.getElementById('wBody2').style.display = n === 2 ? '' : 'none';
        const el = document.getElementById(n === 1 ? 'wAmt' : 'wQty');
        if (el) el.focus();
      },
      unitPrice(item) {
        return (this.currentMode === 'wholesale' && Number(item.wholesalePrice)) || Number(item.price) || 0;
      },
      confirmWAmt(id) {
        const item = S.items.find(product => product.id === id);
        const amount = SaleAccounting.money(document.getElementById('wAmt').value);
        if (!item) return;
        const unitPrice = this.unitPrice(item);
        const quantity = Math.floor((amount / unitPrice) * 1000 + 1e-8) / 1000;
        if (!Number.isFinite(quantity) || quantity < .001) { toast('Enter an amount for at least 0.001 ' + item.unit, 'error'); return; }
        this.showSaleTypePicker(item, quantity, null, amount);
        Modal.close('optModal');
      },
      confirmWQty(id) { const item = S.items.find(i => i.id === id); const qty = parseFloat(document.getElementById('wQty').value); if (!qty || qty <= 0) { toast('Enter quantity', 'error'); return; } Modal.close('optModal'); this.showSaleTypePicker(item, qty); },
      showLiquidModal(item) {
        const cur = S.settings.currency;
        const oh = item.liquidOptions.map((o, i) => `<div class="liq-opt" onclick="POS.selectLiq('${item.id}',${i})"><div class="lbl">${esc(o.label)}</div><div class="prc">${cur} ${(o.price || 0).toFixed(2)}</div><div class="amt">${o.amount} ${item.unit}</div></div>`).join('');
        document.getElementById('optContent').innerHTML = `
      <div class="modal-head"><div class="modal-title">🫙 ${esc(item.name)}</div><button class="modal-x" onclick="Modal.close('optModal')">✕</button></div>
      <p style="color:var(--t2);font-size:12px;margin-bottom:10px">Select option:</p>
      <div class="liq-grid">${oh}</div>
      <hr class="divider">
      <div class="form-group"><label>Custom (${item.unit})</label><div class="flex gap-8"><input type="number" id="custLiq" placeholder="0.5" step="0.01" style="flex:1" inputmode="decimal"><button class="btn btn-ghost btn-sm" onclick="POS.custLiq('${item.id}')">Next →</button></div></div>`;
        Modal.open('optModal');
        const el = document.getElementById('custLiq');
        if (el) el.focus();
      },
      selectLiq(id, idx) { const item = S.items.find(i => i.id === id); const o = item.liquidOptions[idx]; Modal.close('optModal'); this.showSaleTypePicker(item, o.amount, o.label, o.price); },
      custLiq(id) { const item = S.items.find(i => i.id === id); const amt = parseFloat(document.getElementById('custLiq').value); if (!amt || amt <= 0) { toast('Enter amount', 'error'); return; } Modal.close('optModal'); this.showSaleTypePicker(item, amt, null, amt * this.unitPrice(item)); },
      scanBarcode(code) {
        if (!code) return;
        const c = code.trim();
        let item = S.items.find(i => {
          if ((i.barcode || '').split(',').map(b => b.trim()).includes(c)) return true;
          if (i.stockBatches && this.batchHasBarcode(i, c)) return true;
          return false;
        });
        if (item) {
          if (item.type === 'weighted' || item.type === 'liquid') this.addFlow(item.id);
          else {
            const serial = this.batchHasBarcode(item, c) ? c : null;
            Cart.add(item, 1, serial, null, this.currentMode);
          }
        } else toast('Barcode not found: ' + code, 'error');
      },
      batchHasBarcode(item, code) {
        return (item.stockBatches || []).some(batch => Object.values(batch.barcodes || {}).includes(code));
      },
      addCustomItemPrompt() {
        document.getElementById('optContent').innerHTML = `
      <div class="modal-head">
        <div class="modal-title">➕ Quick Custom Item</div>
        <button class="modal-x" onclick="Modal.close('optModal')">✕</button>
      </div>
      <div class="form-group">
        <label>Item Name *</label>
        <input id="customItemName" type="text" placeholder="e.g. Loose Vegetables, Extra Bags" autofocus inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="words" style="background:var(--bg3); border:1px solid var(--border2); color:var(--t1); border-radius:var(--r8);">
      </div>
      <div class="form-group">
        <label>Price *</label>
        <input id="customItemPrice" type="number" placeholder="100.00" min="0" step="0.5" inputmode="decimal" style="background:var(--bg3); border:1px solid var(--border2); color:var(--t1); border-radius:var(--r8);">
      </div>
      <div class="form-group"><label for="customItemCost">Cost (optional)</label><input id="customItemCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Actual cost"></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('optModal')">Cancel</button>
        <button class="btn btn-primary" onclick="POS.confirmCustomItem()">Add</button>
      </div>
    `;
        Modal.open('optModal');
        const el = document.getElementById('customItemName');
        if (el) el.focus();
      },
      confirmCustomItem() {
        const name = document.getElementById('customItemName').value.trim();
        const price = parseFloat(document.getElementById('customItemPrice').value) || 0;
        if (!name) {
          toast('Name is required!', 'error');
          return;
        }
        if (price <= 0) {
          toast('Price must be greater than 0!', 'error');
          return;
        }
        const costText = document.getElementById('customItemCost')?.value.trim() || '';
        const cost = costText === '' ? 0 : Number(costText);
        if (!Number.isFinite(cost) || cost < 0) {toast('Enter a valid nonnegative cost.', 'error');return;}
        const item = {
          costEstimated: costText === '',
          id: 'CUSTOM_' + Date.now(),
          name: name,
          price: price,
          costPrice: cost,
          unit: 'pcs',
          type: 'unit',
          stockBatches: []
        };
        Cart.add(item, 1, null, price, this.currentMode);
        Modal.close('optModal');
      }
    };

    const Cart = {
      add(item, qty, label = null, fixedPrice = null, mode = 'retail') {
        qty = Number(qty);
        const isCustom = String(item.id || '').startsWith('CUSTOM_');
        if (!Number.isFinite(qty) || qty <= 0 || (item.type === 'unit' && !Number.isInteger(qty))) { toast('Enter a valid quantity', 'error'); return; }
        const serialCode = label && POS.batchHasBarcode(item, label) ? label : null;
        if (serialCode && S.cart.some(line => line.itemId === item.id && line.label === label)) {
          toast('This barcode is already in the cart', 'error');
          return;
        }
        const already = S.cart.filter(line => line.itemId === item.id).reduce((sum, line) => sum + Number(line.qty || 0), 0);
        if (!isCustom && already + qty > getStock(item) + 0.0000001) { toast('Insufficient stock for ' + item.name, 'error'); return; }
        const ret = Math.max(0, Number(item.price) || 0);
        const ws = Math.max(0, Number(item.wholesalePrice) || ret);
        const price = fixedPrice !== null ? Number(fixedPrice) : qty * (mode === 'wholesale' ? ws : ret);
        if (!Number.isFinite(price) || price < 0) { toast('Enter a valid price', 'error'); return; }
        const unitPrice = price / qty;
        if (item.type !== 'weighted' && item.type !== 'liquid' && !label && fixedPrice === null) {
          const existing = S.cart.find(line => line.itemId === item.id && !line.label && line.saleMode === mode && line.unitPrice === unitPrice);
          if (existing) { existing.qty += qty; existing.price = SaleAccounting.money(existing.qty * unitPrice); this.render(); return; }
        }
        S.cart.push({ itemId: item.id, name: item.name, qty, unit: item.unit || 'pcs', retailP: ret, wsP: ws, unitPrice, price: SaleAccounting.money(price), label, serialCode, discount: Math.min(100, Math.max(0, Number(item.defaultDiscount) || 0)), discType: 'percent', saleMode: mode, costPrice: Math.max(0, Number(item.costPrice) || 0), isCustom, costEstimated: item.costEstimated === true });
        this.render();
        toast(item.name + ' added', 'success');
      },
      setSaleMode(i, mode, silent = false) {
        const line = S.cart[i]; if (!line || line.isExchangeCredit) return;
        if (mode === 'wholesale' && line.saleMode !== 'wholesale') { line.unitPrice = Number(line.wsP) || line.unitPrice; line.price = SaleAccounting.money(line.qty * line.unitPrice); }
        else if (mode !== 'wholesale' && line.saleMode === 'wholesale') { line.unitPrice = Number(line.retailP) || line.unitPrice; line.price = SaleAccounting.money(line.qty * line.unitPrice); }
        line.saleMode = mode;
        if (!silent) this.render();
      },
      remove(i) { S.cart.splice(i, 1); this.render(); },
      updateQty(i, delta) {
        const line = S.cart[i]; if (!line) return;
        const qty = Math.round((Number(line.qty) + Number(delta)) * 1000) / 1000;
        if (qty <= 0) { this.remove(i); return; }
        if (line.serialCode) { toast('Scan the next barcode to add another unit', 'info'); return; }
        const item = S.items.find(product => product.id === line.itemId);
        const others = S.cart.filter((entry, index) => index !== i && entry.itemId === line.itemId).reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
        if (item && others + qty > getStock(item) + 0.0000001) { toast('Insufficient stock for ' + line.name, 'error'); return; }
        line.qty = qty;
        line.price = SaleAccounting.money(qty * Number(line.unitPrice || 0));
        this.render();
      },
      clear() { if (!S.cart.length) return; if (!confirm('Clear cart?')) return; S.cart = []; S.cartDisc = 0; this.render(); },
      hold() {
        if (!S.cart.length) { toast('Cart is empty — nothing to hold', 'error'); return; }
        const note = prompt('Hold note (optional, e.g. customer name):', '') || '';
        S.heldSales.push({
          id: Date.now(),
          note,
          time: new Date().toLocaleTimeString(),
          cart: JSON.parse(JSON.stringify(S.cart)),
          cartDisc: S.cartDisc,
          cartDiscType: S.cartDiscType,
          total: this.total()
        });
        S.cart = []; S.cartDisc = 0; S.cartDiscType = 'percent';
        this.render();
        toast('🔒 Sale held — cart cleared', 'success');
      },
      sub() { return SaleAccounting.totals(S.cart).subtotal; },
      total() { return SaleAccounting.totals(S.cart).total; },
      render() {
        Drafts.save();
        const cur = S.settings.currency;
        const body = document.getElementById('cartBody'); const count = document.getElementById('cartCount');
        const optionsButton = document.getElementById('paymentOptionsBtn');
        if (optionsButton) optionsButton.disabled = !S.cart.length || S.cart.some(line => line.saleMode === 'loan');
        const btn = document.getElementById('checkoutBtn'); const subEl = document.getElementById('cartSub');
        const totEl = document.getElementById('cartTotal'); const dr = document.getElementById('discRow'); const da = document.getElementById('discAmt');
        count.textContent = S.cart.length;
        // Sync held badge
        const hb = document.getElementById('heldBadge');
        if (hb) { hb.style.display = S.heldSales.length ? 'inline' : 'none'; hb.textContent = S.heldSales.length; }
        const sub = this.sub(); const total = this.total();
        subEl.textContent = `${cur} ${sub.toFixed(2)}`; totEl.textContent = `${cur} ${total.toFixed(2)}`;

        // Sync floating mobile cart button values
        const mcbCount = document.getElementById('mcbCount');
        const mcbTotal = document.getElementById('mcbTotal');
        if (mcbCount) mcbCount.textContent = S.cart.length;
        if (mcbTotal) mcbTotal.textContent = `${cur} ${total.toFixed(2)}`;
        const dv = SaleAccounting.totals(S.cart).cartDiscount; dr.style.display = dv > 0 ? '' : 'none'; da.textContent = `-${cur} ${dv.toFixed(2)}`;
        // Loan items detection
        const loanItems = S.cart.filter(ci => ci.saleMode === 'loan');
        const nonLoanItems = S.cart.filter(ci => ci.saleMode !== 'loan' && !ci.isExchangeCredit);
        const loanRow = document.getElementById('loanRow');
        const loanItemCount = document.getElementById('loanItemCount');
        const loanBtn = document.getElementById('loanCheckoutBtn');
        if (loanRow) { loanRow.style.display = loanItems.length ? '' : 'none'; }
        if (loanItemCount) loanItemCount.textContent = loanItems.length + ' item' + (loanItems.length !== 1 ? 's' : '');
        if (loanBtn) loanBtn.style.display = loanItems.length ? '' : 'none';
        if (loanBtn) loanBtn.disabled = !loanItems.length;
        btn.disabled = nonLoanItems.length === 0 && loanItems.length > 0 ? false : S.cart.length === 0;
        if (nonLoanItems.length === 0 && loanItems.length > 0) btn.disabled = true;
        if (!S.cart.length) { body.innerHTML = `<div class="cart-empty"><div style="font-size:38px;opacity:.3">🛒</div><div>Cart is empty</div><div style="font-size:11px">Click items to add</div></div>`; return; }
        body.innerHTML = S.cart.map((ci, idx) => {
          if (ci.isExchangeCredit) return ExchangeCredits.render(ci, idx);
          const isW = ci.unit === 'kg' || ci.unit === 'L';
          const d = ci.discType === 'percent' ? ci.price * (ci.discount || 0) / 100 : (ci.discount || 0);
          const net = ci.price - d; const qd = isW ? ci.qty.toFixed(3) : ci.qty;
          const m = ci.saleMode || 'retail';
          const isLoan = m === 'loan';
          const modeLabel = m === 'loan' ? '💳 LOAN' : '🏪 Retail';
          const modeBadge = `<span style="font-size:10px;color:${isLoan ? 'var(--red)' : 'var(--cyan)'};font-weight:700;margin-left:4px;">${modeLabel}</span>`;
          const priceTxt = isLoan ? `<span style="color:var(--red);font-size:11px;">💳 LOAN</span>` : `${cur} ${net.toFixed(2)}`;
          const borderStyle = isLoan ? ' style="border-color:rgba(239,68,68,0.3);"' : '';
          return `<div class="cart-item"${borderStyle}>
        <button class="cart-item-del" onclick="Cart.remove(${idx})">✕</button>
        <div class="cart-item-name">${esc(ci.name)}${ci.label ? ` <span style="color:var(--t3)">(${esc(ci.label)})</span>` : ''} ${modeBadge}</div>
        <div class="cart-item-row">
          <div class="qty-ctrl">
            <button class="qty-btn" onclick="Cart.updateQty(${idx},${isW ? -0.1 : -1})">−</button>
            <span class="qty-val">${qd} ${ci.unit}</span>
            <button class="qty-btn" onclick="Cart.updateQty(${idx},${isW ? 0.1 : 1})">+</button>
          </div>
          <span class="cart-item-price">${priceTxt}</span>
        </div>
        ${ci.discount ? `<div class="cart-disc-tag">Disc: ${ci.discount}${ci.discType === 'percent' ? '%' : ' ' + cur}</div>` : ''}
      </div>`;
        }).join('');
      }
    };

    const Discount = {
      openCart() {
        const cur = S.settings.currency;
        document.getElementById('discTitle').textContent = 'Cart Discount';
        document.getElementById('discBody').innerHTML = `<div class="form-group"><label>Type</label><select id="dType"><option value="percent" ${S.cartDiscType === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${S.cartDiscType === 'fixed' ? 'selected' : ''}>Fixed (${esc(cur)})</option></select></div><div class="form-group"><label>Value</label><input type="number" id="dVal" value="${Number(S.cartDisc) || 0}" min="0" step="0.5" inputmode="decimal"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="S.cartDisc=0;Cart.render();Modal.close('discModal')">Remove</button><button class="btn btn-primary" onclick="Discount.applyCart()">Apply</button></div>`;
        Modal.open('discModal');
        document.getElementById('dVal')?.focus();
      },
      openItem() {
        if (!S.cart.length) { toast('Cart empty', 'error'); return; }
        document.getElementById('discTitle').textContent = 'Item Discount';
        const options = S.cart.map((line, i) => `<option value="${i}">${esc(line.name)}</option>`).join('');
        document.getElementById('discBody').innerHTML = `<div class="form-group"><label>Item</label><select id="dItem">${options}</select></div><div class="form-group"><label>Type</label><select id="dIT"><option value="percent">Percentage</option><option value="fixed">Fixed</option></select></div><div class="form-group"><label>Value</label><input type="number" id="dIV" value="0" min="0" step="0.5" inputmode="decimal"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="Modal.close('discModal')">Cancel</button><button class="btn btn-primary" onclick="Discount.applyItem()">Apply</button></div>`;
        Modal.open('discModal');
      },

      applyCart() {
        const type = document.getElementById('dType').value;
        const value = Number(document.getElementById('dVal').value);
        const maximum = type === 'percent' ? 100 : Cart.sub();
        if (!Number.isFinite(value) || value < 0 || value > maximum) { toast('Enter a discount between 0 and ' + maximum, 'error'); return; }
        S.cartDisc = value; S.cartDiscType = type; Cart.render(); Modal.close('discModal');
      },
      applyItem() {
        const line = S.cart[Number(document.getElementById('dItem').value)]; if (!line) return;
        const type = document.getElementById('dIT').value;
        const value = Number(document.getElementById('dIV').value);
        const maximum = type === 'percent' ? 100 : Number(line.price);
        if (!Number.isFinite(value) || value < 0 || value > maximum) { toast('Enter a discount between 0 and ' + maximum, 'error'); return; }
        line.discount = value; line.discType = type; Cart.render(); Modal.close('discModal');
      },

    };

    const CheckoutPayment = {
      open() {
        if (!S.cart.length) return;
        const cur = S.settings.currency || 'Rs.';
        const total = Cart.total();
        document.getElementById('checkoutTotalDisplay').textContent = `${cur} ${total.toFixed(2)}`;

        const payMethodSelect = document.getElementById('checkoutPayMethod');
        payMethodSelect.value = 'cash';
        this.onPayMethodChange();

        const cashInput = document.getElementById('checkoutCashReceived');
        cashInput.value = '';

        this.calcChange();
        Modal.open('checkoutPaymentModal');
        cashInput.focus();
        setTimeout(() => cashInput.focus(), 150);
      },
      onPayMethodChange() {
        const cash = document.getElementById('checkoutPayMethod').value === 'cash';
        document.getElementById('cashReceivedGroup').style.display = cash ? 'block' : 'none';
        document.getElementById('changeDueGroup').style.display = cash ? 'block' : 'none';
        document.getElementById('cashQuickPad').style.display = cash ? 'block' : 'none';
        if (cash) document.getElementById('checkoutCashReceived').focus();
        this.calcChange();
      },
      calcChange() {
        const total = Cart.total();
        const cur = S.settings.currency || 'Rs.';
        const payMethod = document.getElementById('checkoutPayMethod').value;

        if (payMethod !== 'cash') {
          const confirmButton = document.getElementById('confirmCheckoutBtn');
          if (confirmButton) confirmButton.disabled = false;
          document.getElementById('checkoutChangeDue').textContent = `${cur} 0.00`;
          return;
        }

        const cashInput = document.getElementById('checkoutCashReceived');
        const cashVal = parseFloat(cashInput.value) || 0;
        const change = Math.max(0, cashVal - total);

        const okBtn = document.getElementById('confirmCheckoutBtn');
        if (cashVal >= total) {
          if (okBtn) okBtn.disabled = false;
          document.getElementById('checkoutChangeDue').style.color = 'var(--green)';
        } else {
          if (okBtn) okBtn.disabled = true;
          document.getElementById('checkoutChangeDue').style.color = 'var(--red)';
        }

        document.getElementById('checkoutChangeDue').textContent = `${cur} ${change.toFixed(2)}`;
      },
      addCash(amount) {
        const cashInput = document.getElementById('checkoutCashReceived');
        const current = parseFloat(cashInput.value) || 0;
        cashInput.value = (current + amount).toString();
        this.calcChange();
        cashInput.focus();
      },
      setExact() {
        const total = Cart.total();
        const cashInput = document.getElementById('checkoutCashReceived');
        cashInput.value = total.toFixed(2);
        this.calcChange();
        cashInput.focus();
      },
      pressKey(key) {
        const cashInput = document.getElementById('checkoutCashReceived');
        let current = cashInput.value;
        if (key === 'clear') {
          current = '';
        } else if (key === 'backspace') {
          current = current.slice(0, -1);
        } else {
          current += key;
        }
        cashInput.value = current;
        this.calcChange();
        cashInput.focus();
      },
      async confirmSale() {
        const total = Cart.total();
        const payMethod = document.getElementById('checkoutPayMethod').value;
        let cashReceived = total;
        let changeDue = 0;

        if (payMethod === 'cash') {
          const cashInput = document.getElementById('checkoutCashReceived');
          cashReceived = parseFloat(cashInput.value) || 0;
          if (cashReceived < total) {
            toast('Insufficient cash received', 'error');
            return;
          }
          changeDue = cashReceived - total;
        }

        if (Checkout._busy) return;
        Modal.close('checkoutPaymentModal');
        const saved = await Checkout.run(false, {payment: {payMethod, cashReceived, changeDue}});
        if (!saved) Modal.open('checkoutPaymentModal');
      }
    };

    const Checkout = {
      async deductStockForCartItems(cartItems) {
        const plan = SaleAccounting.stockPlan(cartItems);
        if (plan.operations.length) await DB.batch(plan.operations);
        SaleAccounting.applyStock(plan);
      },
      async runWithLoan() {
        if (S.cart.some(line => line.isExchangeCredit)) {toast('Use exchange credit on a paid replacement sale before creating a loan bill.', 'error');return false;}
        if (this._busy) return false;
        const original = [...S.cart];
        const loanItems = original.filter(line => line.saleMode === 'loan');
        const retailItems = original.filter(line => line.saleMode !== 'loan');
        if (!loanItems.length) return this.runDirectCheckout();
        const totals = SaleAccounting.totals(original);
        const retailSub = SaleAccounting.totals(retailItems, 0).subtotal;
        const retailDiscount = totals.subtotal > 0 ? SaleAccounting.money(totals.cartDiscount * retailSub / totals.subtotal) : 0;
        const loanDiscount = SaleAccounting.money(totals.cartDiscount - retailDiscount);
        if (retailItems.length) {
          const completed = await this.run(true, { cartItems: retailItems, discount: retailDiscount, payment: { payMethod: 'cash', cashReceived: SaleAccounting.money(retailSub - retailDiscount), changeDue: 0 } });
          if (!completed) return false;
        }
        const loanSub = SaleAccounting.totals(loanItems, 0).subtotal;
        const total = SaleAccounting.money(loanSub - loanDiscount);
        S.cartDisc = loanDiscount; S.cartDiscType = 'fixed';
        Cart.render();
        const prefill = { desc: loanItems.map(line => line.name).join(', '), itemDetails: loanItems.map(line => `${line.name} x${line.qty} (${S.settings.currency} ${SaleAccounting.lineNet(line).toFixed(2)})`).join('\n'), total, stockItems: loanItems.map(line => ({ ...line })), cartRows: loanItems };
        window._loanPrefill = prefill;
        Nav.go('loans');
        await LoanMgr.render();
        LoanMgr.openNewLoan(null, prefill);
        return true;
      },
      async run(silent = false, options = {}) {
        if (this._busy || !S.cart.length) return false;
        if (!options.cartItems && S.cart.some(line => line.saleMode === 'loan')) return this.runWithLoan();
        this._busy = true;
        const allCart = options.cartItems || [...S.cart];
        const cart = allCart.filter(line => !line.isExchangeCredit);
        try {
          if (!cart.length) throw new Error('Add replacement products before using exchange credit');
          const totals = options.cartItems ? SaleAccounting.totals(allCart, options.discount || 0, 'fixed') : SaleAccounting.totals(allCart);
          const credits = ExchangeCredits.plan(allCart, totals.saleTotal, true);
          const plan = SaleAccounting.stockPlan(cart);
          const supplied = options.payment || window._lastPaymentDetails;
          const payment = supplied || { payMethod: 'cash', cashReceived: totals.total, changeDue: 0 };
          const payMethod = ['cash', 'card', 'online'].includes(payment.payMethod) ? payment.payMethod : 'cash';
          const received = payMethod === 'cash' ? Number(payment.cashReceived) : totals.total;
          if (!Number.isFinite(received) || received < totals.total) throw new Error('Insufficient cash received');
          const id = DB.newId();
          const billDate = new Date();
          const billId = 'BILL-' + billDate.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17) + '-' + id.slice(-5);
          const items = cart.map((line, index) => ({ itemId: line.itemId, name: line.name, qty: Number(line.qty), unit: line.unit, unitPrice: Number(line.price) / Number(line.qty), costPrice: plan.costs[index] / Number(line.qty), costTotal: plan.costs[index], discount: Math.max(0, Number(line.discount) || 0), discType: line.discType || 'percent', price: SaleAccounting.lineNet(line), saleMode: line.saleMode || 'retail', label: line.label || null, serialCode: line.serialCode || null, isCustom: SaleAccounting.isCustom(line), costEstimated: line.costEstimated === true }));
          const cost = SaleAccounting.money(plan.costs.reduce((sum, amount) => sum + amount, 0));
          const sale = { billId, date: billDate.toISOString(), items, costEstimated: items.some(item => item.costEstimated), subtotal: totals.subtotal, cartDiscount: totals.cartDiscount, total: totals.saleTotal, exchangeCreditAmount: totals.creditApplied, exchangeCredits: credits.map(credit => ({id:credit.id,amount:credit.amount})), profit: SaleAccounting.money(totals.saleTotal - cost), status: 'completed', payMethod, cashReceived: SaleAccounting.money(received), changeDue: payMethod === 'cash' ? SaleAccounting.money(received - totals.total) : 0 };
          sale.receiptText = ReceiptFormatter.buildText(sale);
          await DB.batch([...plan.operations, ...ExchangeCredits.operations(credits, id), { type: 'set', path: 'sales/' + id, data: sale }]);
          SaleAccounting.applyStock(plan);
          sale.id = id;
          window._lastSale = sale;
          window._lastPaymentDetails = null;
          S.cart = S.cart.filter(line => !allCart.includes(line));
          if (!S.cart.length) { S.cartDisc = 0; S.cartDiscType = 'percent'; }
          Cart.render();
          if (!silent && !S.cart.length) POS.toggleCartView(false);
          await loadAll();
          if (!silent) { try { Receipt.show(sale); } catch (error) { toast('Sale saved. Receipt could not open: ' + error.message, 'error'); } }
          if (!silent) toast('Sale completed', 'success');
          return true;
        } catch (error) {
          toast('Sale error: ' + error.message, 'error');
          return false;
        } finally { this._busy = false; }
      },
      async runDirectCheckout() {
        if (this._busy) return false;
        window._lastPaymentDetails = null;
        if (S.cart.some(line => line.saleMode === 'loan')) return this.runWithLoan();
        return this.run(false, { payment: { payMethod: 'cash', cashReceived: Cart.total(), changeDue: 0 } });
      },

    };

    const LoanMgr = {
      _customers: [],
      _loans: [],
      _activeCustomerId: null,

      loadData() {
        this._customers = S.loan_customers || [];
        this._loans = S.loans || [];
      },

      _num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      },

      _total(loan) {
        return this._num(loan?.totalAmount);
      },

      _paid(loan) {
        return this._num(loan?.paidAmount);
      },

      _remaining(loan) {
        return Math.max(0, this._total(loan) - this._paid(loan));
      },

      render() {
        this.loadData();
        this._renderStats();
        this._renderCustList();
        this._checkDueNotifications();
        if (this._activeCustomerId) this._renderRight(this._activeCustomerId);
      },

      _renderStats() {
        const el = document.getElementById('loanStats'); if (!el) return;
        const cur = S.settings.currency;
        const activeLoans = this._loans.filter(l => l.status !== 'cleared' && this._remaining(l) > 0);
        const totalOwed = activeLoans.reduce((s, l) => s + this._remaining(l), 0);
        const totalGiven = this._loans.reduce((s, l) => s + this._total(l), 0);
        const totalRecovered = this._loans.reduce((s, l) => s + this._paid(l), 0);
        const overdueLoans = activeLoans.filter(l => this._isOverdue(l)).length;
        el.innerHTML = `
      <div class="loan-stat"><div class="loan-stat-lbl">Total Outstanding</div><div class="loan-stat-val" style="color:var(--red)">${cur} ${totalOwed.toFixed(2)}</div></div>
      <div class="loan-stat"><div class="loan-stat-lbl">Total Given</div><div class="loan-stat-val" style="color:var(--cyan)">${cur} ${totalGiven.toFixed(2)}</div></div>
      <div class="loan-stat"><div class="loan-stat-lbl">Recovered</div><div class="loan-stat-val" style="color:var(--green)">${cur} ${totalRecovered.toFixed(2)}</div></div>
      <div class="loan-stat"><div class="loan-stat-lbl">Active Loans</div><div class="loan-stat-val">${activeLoans.length}</div></div>
      <div class="loan-stat"><div class="loan-stat-lbl">Overdue</div><div class="loan-stat-val" style="color:${overdueLoans > 0 ? 'var(--red)' : 'var(--green)'}">${overdueLoans}</div></div>
      <div class="loan-stat"><div class="loan-stat-lbl">Customers</div><div class="loan-stat-val">${this._customers.length}</div></div>`;
      },

      filter() {
        const q = (document.getElementById('loanSearch')?.value || '').toLowerCase();
        this._renderCustList(q);
      },

      _renderCustList(q = '') {
        const el = document.getElementById('loanCustList'); if (!el) return;
        const cur = S.settings.currency;
        let custs = [...this._customers];
        if (q) custs = custs.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q));
        if (!custs.length) {
          el.innerHTML = `<div style="text-align:center;color:var(--t3);padding:40px 12px;font-size:12px;">${this._customers.length ? 'No results.' : 'No customers yet.<br>Add a customer to start.'}</div>`; return;
        }
        el.innerHTML = custs.map(c => {
          const loans = this._loans.filter(l => l.customerId === c.id && l.status !== 'cleared' && this._remaining(l) > 0);
          const owed = loans.reduce((s, l) => s + this._remaining(l), 0);
          const hasOverdue = loans.some(l => this._isOverdue(l));
          const initial = (c.name || '?')[0].toUpperCase();
          const active = this._activeCustomerId === c.id;
          return `<div class="loan-cust-row${active ? ' active' : ''}" onclick="LoanMgr._selectCustomer('${c.id}')">
        <div class="loan-cust-avatar">${initial}</div>
        <div class="loan-cust-info">
          <div class="loan-cust-name">${esc(c.name)}</div>
          <div class="loan-cust-phone">${esc(c.phone || '—')}</div>
        </div>
        <div class="loan-cust-badge">
          <div class="loan-cust-owe${owed <= 0 ? ' paid' : ''}">${owed > 0 ? `${cur} ${owed.toFixed(2)}` : '✓ Clear'}</div>
          ${hasOverdue ? `<div style="font-size:9px;color:var(--red);font-weight:700;">⚠ OVERDUE</div>` : ''}
          <div style="font-size:9px;color:var(--t3);">${loans.length} loan${loans.length !== 1 ? 's' : ''}</div>
        </div>
      </div>`;
        }).join('');
      },

      _selectCustomer(id) {
        this._activeCustomerId = id;
        this._renderCustList(document.getElementById('loanSearch')?.value || '');
        this._renderRight(id);
      },

      _renderRight(customerId) {
        const el = document.getElementById('loanRight'); if (!el) return;

        // Toggle active customer class for mobile layout
        const mainEl = document.querySelector('.loan-main');
        if (mainEl) mainEl.classList.toggle('customer-active', !!customerId);

        const cur = S.settings.currency;
        const cust = this._customers.find(c => c.id === customerId);
        if (!cust) { el.innerHTML = ''; return; }
        const loans = this._loans.filter(l => l.customerId === customerId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const totalOwed = loans.filter(l => l.status !== 'cleared').reduce((s, l) => s + this._remaining(l), 0);
        el.innerHTML = `
      <!-- Mobile back button -->
      <div class="mobile-only" onclick="LoanMgr._selectCustomer(null)" style="display:none;align-items:center;gap:6px;margin-bottom:12px;padding:10px 12px;background:var(--cyan3);border:1px solid rgba(0, 242, 254, 0.25);border-radius:var(--r8);color:var(--cyan);font-weight:bold;cursor:pointer;width:100%;font-size:12.5px;">
        ← Back to Customers
      </div>
      <!-- Customer header -->
      <div style="background:var(--glass2);border:1px solid var(--border2);border-radius:var(--r12);padding:14px;display:flex;align-items:flex-start;gap:12px;">
        <div style="flex-shrink:0;">
          ${cust.photo1 || cust.photo2
            ? `<div style="display:flex;gap:6px;">
                ${cust.photo1 ? `<img src="${cust.photo1}" style="width:52px;height:52px;border-radius:var(--r8);object-fit:cover;border:1px solid var(--border2);" alt="ID">` : ''}
                ${cust.photo2 ? `<img src="${cust.photo2}" style="width:52px;height:52px;border-radius:var(--r8);object-fit:cover;border:1px solid var(--border2);" alt="Photo">` : ''}
               </div>`
            : `<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#000;">${(cust.name || '?')[0].toUpperCase()}</div>`
          }
        </div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800;">${esc(cust.name)}</div>
          <div style="font-size:12px;color:var(--t2);">📞 ${esc(cust.phone || '—')} &nbsp;|&nbsp; 🏠 ${esc(cust.address || '—')}</div>
          ${cust.notes ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;">📝 ${esc(cust.notes)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:11px;color:var(--t3);">Total Outstanding</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:900;color:${totalOwed > 0 ? 'var(--red)' : 'var(--green)'};">${totalOwed > 0 ? `${cur} ${totalOwed.toFixed(2)}` : '✓ All Clear'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <button class="btn btn-primary btn-sm" onclick="LoanMgr.openNewLoan('${cust.id}')">➕ New Loan</button>
          <button class="btn btn-ghost btn-sm" onclick="LoanMgr.openCustomerForm('${cust.id}')">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="LoanMgr.deleteCustomer('${cust.id}')">🗑️</button>
        </div>
      </div>
      <!-- Loans -->
      <div style="font-size:12px;font-weight:700;color:var(--t2);padding:4px 0 2px;">LOANS (${loans.length})</div>
      ${loans.length ? loans.map(l => this._loanCard(l, cur)).join('')
            : `<div style="text-align:center;color:var(--t3);padding:30px;font-size:12px;">No loans yet for this customer.</div>`}`;
      },

      _loanCard(loan, cur) {
        const total = this._total(loan);
        const paid = this._paid(loan);
        const remaining = this._remaining(loan);
        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
        const isCleared = loan.status === 'cleared' || remaining <= 0;
        const overdue = this._isOverdue(loan);
        const borderColor = isCleared ? 'rgba(16,185,129,0.3)' : overdue ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)';
        const installmentSchedule = this._paymentSchedule(loan, paid);
        const instHTML = installmentSchedule.length ? `
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:6px;">📅 Installment Schedule</div>
        ${installmentSchedule.map((inst, i) => {
          const due = new Date(inst.dueDate); const now = new Date();
          const daysLeft = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
          let cls = 'upcoming', dotCls = 'upcoming', info = '';
          if (inst.paid) { cls = 'paid-inst'; dotCls = 'paid-inst'; info = `✓ Paid ${inst.paidDate ? new Date(inst.paidDate).toLocaleDateString() : ''}`; }
          else if (daysLeft < 0) { cls = 'overdue'; dotCls = 'overdue'; info = `⚠ ${Math.abs(daysLeft)}d overdue`; }
          else if (daysLeft <= 7) { cls = 'due'; dotCls = 'due'; info = `⏰ Due in ${daysLeft}d`; }
          else info = `${due.toLocaleDateString()}`;
          return `<div class="loan-installment-row ${cls}">
            <div class="inst-dot ${dotCls}"></div>
            <div style="flex:1;font-size:11px;">Installment ${i + 1} — ${cur} ${(inst.amount || 0).toFixed(2)}</div>
            <div style="font-size:10px;color:var(--t2);">${info}</div>
            ${!inst.paid ? `<button class="btn btn-success btn-xs" onclick="LoanMgr.markInstallmentPaid('${loan.id}',${i})">✓</button>` : ''}
          </div>`;
        }).join('')}
      </div>`: '';
        return `<div class="loan-card" style="border-color:${borderColor};">
      <div class="loan-card-head">
        <div>
          <div class="loan-card-title">${esc(loan.description || 'Loan')} ${isCleared ? '<span class="badge badge-green">Cleared ✓</span>' : overdue ? '<span class="badge badge-red">⚠ Overdue</span>' : ''}</div>
          <div class="loan-card-date">📅 ${new Date(loan.createdAt).toLocaleDateString()} &nbsp;|&nbsp; ${loan.installments?.length ? `${loan.installments.length} installments` : 'No installment plan'}</div>
          ${loan.items ? `<div style="font-size:11px;color:var(--t2);margin-top:3px;">🛍 ${esc(loan.items)}</div>` : ''}
        </div>
        <div style="display:flex;gap:5px;align-items:flex-start;flex-shrink:0;">
          ${!isCleared ? `<button class="btn btn-primary btn-xs" onclick="LoanMgr.openPayment('${loan.id}')">💰 Pay</button>` : ''}
          ${isCleared ? `<button class="btn btn-danger btn-xs" onclick="LoanMgr.clearLoan('${loan.id}')">🗑 Remove</button>` : `<button class="btn btn-success btn-xs" onclick="LoanMgr.markCleared('${loan.id}')">✓ Clear</button>`}
        </div>
      </div>
      <div class="loan-amounts">
        <div class="loan-amt-block"><div class="loan-amt-lbl">Total</div><div class="loan-amt-val" style="color:var(--t1);">${cur} ${total.toFixed(2)}</div></div>
        <div class="loan-amt-block"><div class="loan-amt-lbl">Paid</div><div class="loan-amt-val" style="color:var(--green);">${cur} ${paid.toFixed(2)}</div></div>
        <div class="loan-amt-block"><div class="loan-amt-lbl">Remaining</div><div class="loan-amt-val" style="color:${remaining > 0 ? 'var(--red)' : 'var(--green)'};">${cur} ${Math.max(0, remaining).toFixed(2)}</div></div>
      </div>
      <div class="loan-progress"><div class="loan-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div style="font-size:10px;color:var(--t3);text-align:right;">${pct.toFixed(0)}% paid</div>
      ${loan.paymentHistory?.length ? `
        <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:4px;">Payment History</div>
          ${loan.paymentHistory.slice(-5).reverse().map(p => `
            <div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border);">
              <span style="color:var(--t2);">${new Date(p.date).toLocaleDateString()} ${p.note ? `— ${esc(p.note)}` : ''}</span>
              <span style="font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700;">+${cur} ${(p.amount || 0).toFixed(2)}</span>
            </div>`).join('')}
        </div>`: ''}
      ${instHTML}
    </div>`;
      },

      _isOverdue(loan) {
        if (loan.status === 'cleared' || this._remaining(loan) <= 0) return false;
        if (!loan.installments?.length) {
          if (loan.dueDate && new Date(loan.dueDate) < new Date()) return true;
          return false;
        }
        return this._paymentSchedule(loan, this._paid(loan)).some(i => !i.paid && new Date(i.dueDate + 'T23:59:59') < new Date());
      },

      _checkDueNotifications() {
        const cur = S.settings.currency;
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const soonLoans = [];
        this._loans.filter(l => l.status !== 'cleared').forEach(loan => {
          const cust = this._customers.find(c => c.id === loan.customerId);
          if (!cust) return;
          (loan.installments || []).forEach((inst, i) => {
            if (inst.paid) return;
            const due = new Date(inst.dueDate);
            const daysLeft = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
            if (daysLeft >= 0 && daysLeft <= 3) {
              soonLoans.push({ name: cust.name, amount: inst.amount, daysLeft, loanDesc: loan.description || 'Loan' });
            } else if (daysLeft < 0) {
              soonLoans.push({ name: cust.name, amount: inst.amount, daysLeft, loanDesc: loan.description || 'Loan', overdue: true });
            }
          });
          // Simple due date (no installments)
          if (!loan.installments?.length && loan.dueDate) {
            const daysLeft = Math.ceil((new Date(loan.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
            if (daysLeft >= 0 && daysLeft <= 3) soonLoans.push({ name: cust.name, amount: loan.totalAmount - loan.paidAmount, daysLeft, loanDesc: loan.description || 'Loan' });
            else if (daysLeft < 0) soonLoans.push({ name: cust.name, amount: loan.totalAmount - loan.paidAmount, daysLeft, loanDesc: loan.description || 'Loan', overdue: true });
          }
        });
        soonLoans.forEach(n => {
          if (n.overdue) { toast(`⚠️ OVERDUE: ${n.name} — ${cur} ${(n.amount || 0).toFixed(2)} (${n.loanDesc})`, 'error'); }
          else { toast(`⏰ Due in ${n.daysLeft}d: ${n.name} — ${cur} ${(n.amount || 0).toFixed(2)} (${n.loanDesc})`, 'info'); }
        });
      },

      openCustomerForm(id = null) {
        const cust = id ? this._customers.find(c => c.id === id) : null;
        // Photos state (up to 2 base64 strings)
        window._custPhotos = [cust?.photo1 || null, cust?.photo2 || null];
        document.getElementById('loanCustTitle').textContent = cust ? '✏️ Edit Customer' : '👤 Add Customer';
        document.getElementById('loanCustBody').innerHTML = `
      <div class="cust-photo-zone">
        <div class="cust-photo-slot" id="cps0"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="LoanMgr._dropPhoto(event,0)"
          onpaste="LoanMgr._pastePhoto(event,0)"
          onclick="document.getElementById('cpFile0').click()"
          tabindex="0">
          <input type="file" id="cpFile0" accept="image/*" style="display:none" onchange="LoanMgr._filePhoto(event,0)">
          <div id="cpi0">${window._custPhotos[0]
            ? `<img src="${window._custPhotos[0]}" alt="Photo 1"><button class="cust-photo-del" onclick="event.stopPropagation();LoanMgr._removePhoto(0)">✕</button>`
            : `<div class="photo-hint"><span>🪪</span>Photo 1<br><small>drag / paste / click</small></div>`
          }</div>
        </div>
        <div class="cust-photo-slot" id="cps1"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="LoanMgr._dropPhoto(event,1)"
          onpaste="LoanMgr._pastePhoto(event,1)"
          onclick="document.getElementById('cpFile1').click()"
          tabindex="0">
          <input type="file" id="cpFile1" accept="image/*" style="display:none" onchange="LoanMgr._filePhoto(event,1)">
          <div id="cpi1">${window._custPhotos[1]
            ? `<img src="${window._custPhotos[1]}" alt="Photo 2"><button class="cust-photo-del" onclick="event.stopPropagation();LoanMgr._removePhoto(1)">✕</button>`
            : `<div class="photo-hint"><span>📷</span>Photo 2<br><small>drag / paste / click</small></div>`
          }</div>
        </div>
      </div>
      <div class="form-group"><label>Full Name *</label><input id="lcName" type="text" value="${esc(cust?.name || '')}" placeholder="Customer name" autofocus inputmode="text" autocomplete="off" autocapitalize="words"></div>
      <div class="form-group"><label>Phone</label><input id="lcPhone" type="tel" value="${esc(cust?.phone || '')}" placeholder="07X XXXXXXX" inputmode="tel"></div>
      <div class="form-group"><label>Address</label><input id="lcAddr" type="text" value="${esc(cust?.address || '')}" placeholder="Address" inputmode="text"></div>
      <div class="form-group"><label>Notes</label><textarea id="lcNotes" rows="2" inputmode="text">${esc(cust?.notes || '')}</textarea></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('loanCustomerModal')">Cancel</button>
        <button class="btn btn-primary" onclick="LoanMgr.saveCustomer(${id ? `'${id}'` : null})">💾 Save</button>
      </div>`;
        // Enable paste on slots
        setTimeout(() => {
          ['cps0', 'cps1'].forEach((sid, i) => {
            const el = document.getElementById(sid);
            if (el) el.addEventListener('paste', e => LoanMgr._pastePhoto(e, i));
          });
        }, 100);
        Modal.open('loanCustomerModal');
        const lcNameEl = document.getElementById('lcName');
        if (lcNameEl) lcNameEl.focus();
      },

      _photoSlotUpdate(idx) {
        const el = document.getElementById('cpi' + idx); if (!el) return;
        if (window._custPhotos[idx]) {
          el.innerHTML = `<img src="${window._custPhotos[idx]}" alt="Photo ${idx + 1}"><button class="cust-photo-del" onclick="event.stopPropagation();LoanMgr._removePhoto(${idx})">✕</button>`;
        } else {
          el.innerHTML = `<div class="photo-hint"><span>${idx === 0 ? '🪪' : '📷'}</span>Photo ${idx + 1}<br><small>drag / paste / click</small></div>`;
        }
        const slot = document.getElementById('cps' + idx);
        if (slot) slot.classList.remove('drag-over');
      },

      _removePhoto(idx) { window._custPhotos[idx] = null; this._photoSlotUpdate(idx); },

      _readImgFile(file, idx) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = e => {
          // Compress to max 600px wide
          const img = new Image();
          img.onload = () => {
            const max = 600; const scale = Math.min(1, max / img.width);
            const c = document.createElement('canvas');
            c.width = img.width * scale; c.height = img.height * scale;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            window._custPhotos[idx] = c.toDataURL('image/jpeg', 0.82);
            this._photoSlotUpdate(idx);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      },

      _filePhoto(event, idx) {
        const file = event.target.files[0];
        if (file) this._readImgFile(file, idx);
        event.target.value = '';
      },

      _dropPhoto(event, idx) {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) this._readImgFile(file, idx);
        document.getElementById('cps' + idx)?.classList.remove('drag-over');
      },

      _pastePhoto(event, idx) {
        const items = event.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            this._readImgFile(item.getAsFile(), idx);
            return;
          }
        }
      },

      async saveCustomer(id) {
        const name = document.getElementById('lcName').value.trim();
        if (!name) { toast('Name required', 'error'); return; }
        const data = {
          name,
          phone: document.getElementById('lcPhone').value.trim(),
          address: document.getElementById('lcAddr').value.trim(),
          notes: document.getElementById('lcNotes').value.trim(),
          photo1: window._custPhotos?.[0] || null,
          photo2: window._custPhotos?.[1] || null,
          updatedAt: new Date().toISOString()
        };
        if (!id) { data.createdAt = new Date().toISOString(); await DB.push('loan_customers', data); }
        else await DB.patch('loan_customers/' + id, data);
        Modal.close('loanCustomerModal');
        toast('Customer saved ✅', 'success');
        await loadAll();
      },

      async deleteCustomer(id) {
        const loans = this._loans.filter(l => l.customerId === id && l.status !== 'cleared');
        if (loans.length && !confirm(`This customer has ${loans.length} active loan(s). Delete anyway?`)) return;
        if (!confirm('Delete customer and all their loans?')) return;
        const allLoans = this._loans.filter(l => l.customerId === id);
        for (const l of allLoans) await DB.del('loans/' + l.id);
        await DB.del('loan_customers/' + id);
        if (this._activeCustomerId === id) this._activeCustomerId = null;
        toast('Customer deleted', 'info');
        await loadAll();
      },

      openNewLoan(preCustomerId = null, prefill = null) {
        this._prefill = prefill;
        window._loanPrefill = prefill;
        const custOpts = this._customers.map(c => `<option value="${c.id}" ${c.id === preCustomerId ? 'selected' : ''}>${esc(c.name)} — ${esc(c.phone || '')}</option>`).join('');
        document.getElementById('loanNewBody').innerHTML = `
      <div class="form-group">
        <label>Customer *</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="lnCust" style="flex:1;" onchange="LoanMgr._onLnCustChange()">
            <option value="">— Select customer —</option>
            ${custOpts}
            <option value="__new__">➕ Add New Customer…</option>
          </select>
        </div>
        <!-- Inline quick-add customer panel (hidden by default) -->
        <div id="lnNewCustPanel" style="display:none;margin-top:10px;padding:12px;background:var(--bg3);border:1px solid var(--cyan);border-radius:var(--r8);">
          <div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:8px;">👤 New Customer</div>
          <div class="cust-photo-zone" style="margin-bottom:10px;">
            <div class="cust-photo-slot" id="lncps0"
              ondragover="event.preventDefault();this.classList.add('drag-over')"
              ondragleave="this.classList.remove('drag-over')"
              ondrop="LoanMgr._dropPhoto(event,0)"
              onclick="document.getElementById('lncpFile0').click()">
              <input type="file" id="lncpFile0" accept="image/*" style="display:none" onchange="LoanMgr._filePhoto(event,0)">
              <div id="cpi0"><div class="photo-hint"><span>🪪</span>ID Photo<br><small>drag / click / paste</small></div></div>
            </div>
            <div class="cust-photo-slot" id="lncps1"
              ondragover="event.preventDefault();this.classList.add('drag-over')"
              ondragleave="this.classList.remove('drag-over')"
              ondrop="LoanMgr._dropPhoto(event,1)"
              onclick="document.getElementById('lncpFile1').click()">
              <input type="file" id="lncpFile1" accept="image/*" style="display:none" onchange="LoanMgr._filePhoto(event,1)">
              <div id="cpi1"><div class="photo-hint"><span>📷</span>Photo 2<br><small>drag / click / paste</small></div></div>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-group" style="margin-bottom:8px;"><label>Full Name *</label><input id="lnNewName" type="text" placeholder="Customer name" inputmode="text" autocomplete="off" autocapitalize="words"></div>
            <div class="form-group" style="margin-bottom:8px;"><label>Phone</label><input id="lnNewPhone" type="tel" placeholder="07X XXXXXXX" inputmode="tel"></div>
          </div>
          <div class="form-group" style="margin-bottom:8px;"><label>Address</label><input id="lnNewAddr" type="text" placeholder="Address" inputmode="text"></div>
          <div class="form-group" style="margin-bottom:8px;"><label>Notes</label><textarea id="lnNewNotes" rows="1" style="min-height:36px;" inputmode="text"></textarea></div>
          <button class="btn btn-primary btn-sm w-full" onclick="LoanMgr.saveInlineCustomer()">✅ Save Customer &amp; Continue</button>
        </div>
      </div>
      <div class="form-group"><label>Description / Item(s)</label><input id="lnDesc" type="text" value="${esc(prefill?.desc || '')}" placeholder="e.g. Weekly chicken order" inputmode="text"></div>
      <div class="form-group"><label>Items borrowed (details)</label><textarea id="lnItems" rows="2" inputmode="text">${esc(prefill?.itemDetails || '')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label>Total Loan Amount (${S.settings.currency}) *</label><input id="lnTotal" type="number" min="0" step="0.5" value="${prefill?.total || ''}" placeholder="0.00" oninput="LoanMgr._previewInstallments()" inputmode="decimal"></div>
        <div class="form-group"><label>Initial Payment (${S.settings.currency})</label><input id="lnInit" type="number" min="0" step="0.5" value="0" placeholder="0.00" oninput="LoanMgr._previewInstallments()" inputmode="decimal"></div>
      </div>
      <div class="form-group"><label>Simple Due Date (optional)</label><input id="lnDue" type="date"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px;">📅 Installment Plan (optional)</div>
      <div class="grid-2">
        <div class="form-group"><label>Number of Installments</label><input id="lnInstCount" type="number" min="0" max="60" value="0" placeholder="0 = no plan" oninput="LoanMgr._previewInstallments()" inputmode="numeric"></div>
        <div class="form-group"><label>Every (months)</label><input id="lnInstEvery" type="number" min="1" max="12" value="1" oninput="LoanMgr._previewInstallments()" inputmode="numeric"></div>
      </div>
      <div class="form-group"><label>First Installment Date</label><input id="lnInstStart" type="date" value="${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}" oninput="LoanMgr._previewInstallments()"></div>
      <div id="lnInstPreview" style="font-size:11px;color:var(--t2);margin-bottom:8px;"></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('loanNewModal')">Cancel</button>
        <button class="btn btn-primary" onclick="LoanMgr.saveLoan()">💾 Create Loan</button>
      </div>`;
        // init photo state
        window._custPhotos = [null, null];
        // enable paste on photo slots
        setTimeout(() => {
          ['lncps0', 'lncps1'].forEach((sid, i) => {
            const el = document.getElementById(sid);
            if (el) el.addEventListener('paste', e => LoanMgr._pastePhoto(e, i));
          });
          // pre-select if only one customer
          if (this._customers.length === 1 && !preCustomerId) {
            const sel = document.getElementById('lnCust');
            if (sel) sel.value = this._customers[0].id;
          }
        }, 80);
        Modal.open('loanNewModal');
        const lnCustSelect = document.getElementById('lnCust');
        if (lnCustSelect) lnCustSelect.focus();
      },

      _onLnCustChange() {
        const val = document.getElementById('lnCust')?.value;
        const panel = document.getElementById('lnNewCustPanel');
        if (panel) panel.style.display = val === '__new__' ? '' : 'none';
        if (val === '__new__') {
          window._custPhotos = [null, null];
          setTimeout(() => document.getElementById('lnNewName')?.focus(), 80);
        }
      },

      async saveInlineCustomer() {
        const name = document.getElementById('lnNewName')?.value.trim();
        if (!name) { toast('Name required', 'error'); return; }
        const data = {
          name,
          phone: document.getElementById('lnNewPhone')?.value.trim() || '',
          address: document.getElementById('lnNewAddr')?.value.trim() || '',
          notes: document.getElementById('lnNewNotes')?.value.trim() || '',
          photo1: window._custPhotos?.[0] || null,
          photo2: window._custPhotos?.[1] || null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        const newId = await DB.push('loan_customers', data);
        toast(`✅ Customer "${name}" added!`, 'success');

        // ── FIX: Immediately update S.loan_customers so loadData() sees the new customer
        // without waiting for next loadAll() / sync cycle
        if (!S.loan_customers) S.loan_customers = [];
        S.loan_customers.push({ id: newId, ...data });

        // Reload internal list from updated S
        this.loadData();

        // ── FIX: Rebuild dropdown from this._customers (which now includes the new customer)
        // Previously newOpt was created but never appended — new customer never showed up
        const sel = document.getElementById('lnCust');
        if (sel) {
          sel.innerHTML = `<option value="">— Select customer —</option>`;
          this._customers.forEach(c => {
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = `${esc(c.name)} — ${c.phone || ''}`;
            sel.appendChild(o);
          });
          const addNewOpt = document.createElement('option');
          addNewOpt.value = '__new__';
          addNewOpt.textContent = '➕ Add New Customer…';
          sel.appendChild(addNewOpt);
          sel.value = newId; // Auto-select the newly added customer
        }
        // hide panel
        const panel = document.getElementById('lnNewCustPanel');
        if (panel) panel.style.display = 'none';
        // reset photos
        window._custPhotos = [null, null];
        // refresh left list in background
        this._renderCustList();
        this._renderStats();
      },

      _previewInstallments() {
        const count = parseInt(document.getElementById('lnInstCount')?.value) || 0;
        const el = document.getElementById('lnInstPreview'); if (!el) return;
        if (!count) { el.textContent = ''; return; }
        const every = parseInt(document.getElementById('lnInstEvery')?.value) || 1;
        const start = document.getElementById('lnInstStart')?.value;
        const total = parseFloat(document.getElementById('lnTotal')?.value) || 0;
        const initial = Math.max(0, Number(document.getElementById('lnInit')?.value) || 0);
        const instAmt = total > 0 ? (Math.max(0, total - initial) / count).toFixed(2) : 0;
        el.innerHTML = `✅ ${count} installments of ${S.settings.currency} ${instAmt} each, every ${every} month(s), starting ${start || '—'}`;
      },

      async saveLoan() {
        if (this._busy) return false;
        const custId = document.getElementById('lnCust')?.value;
        if (!custId || custId === '__new__' || !this._customers.some(customer => customer.id === custId)) { toast('Select or add a customer first', 'error'); return false; }
        const total = SaleAccounting.money(document.getElementById('lnTotal').value);
        const initPay = SaleAccounting.money(document.getElementById('lnInit').value);
        const count = Number(document.getElementById('lnInstCount')?.value || 0);
        const every = Number(document.getElementById('lnInstEvery')?.value || 1);
        const startStr = document.getElementById('lnInstStart')?.value;
        if (total <= 0 || initPay < 0 || initPay > total) { toast('Enter a positive loan amount and an initial payment within the total', 'error'); return false; }
        if (!Number.isInteger(count) || count < 0 || count > 60 || !Number.isInteger(every) || every < 1 || every > 12) { toast('Enter a valid installment plan', 'error'); return false; }
        const start = new Date(startStr + 'T12:00:00Z');
        if (count > 0 && !Number.isFinite(start.getTime())) { toast('Enter the first installment date', 'error'); return false; }
        this._busy = true;
        try {
          const installments = [];
          const balanceCents = Math.round((total - initPay) * 100);
          let allocatedCents = 0;
          for (let i = 0; i < count; i++) {
            const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i * every, 1, 12));
            const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
            month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
            const nextCents = Math.round(balanceCents * (i + 1) / count);
            installments.push({ dueDate: month.toISOString().slice(0, 10), amount: (nextCents - allocatedCents) / 100, paid: nextCents === allocatedCents });
            allocatedCents = nextCents;
          }
          const now = new Date().toISOString();
          const loan = { customerId: custId, description: document.getElementById('lnDesc').value.trim() || 'Loan', items: document.getElementById('lnItems').value.trim() || null, totalAmount: total, paidAmount: initPay, dueDate: document.getElementById('lnDue').value || null, installments, paymentHistory: initPay > 0 ? [{ date: now, amount: initPay, note: 'Initial payment' }] : [], status: initPay >= total ? 'cleared' : 'active', createdAt: now };
          const prefill = this._prefill;
          const plan = prefill?.stockItems?.length ? SaleAccounting.stockPlan(prefill.stockItems) : { products: new Map(), operations: [] };
          if (prefill?.stockItems?.length) loan.stockItems = prefill.stockItems.map(line => ({ itemId: line.itemId, name: line.name, qty: Number(line.qty), label: line.label || null }));
          const id = DB.newId();
          await DB.batch([...plan.operations, { type: 'set', path: 'loans/' + id, data: loan }]);
          SaleAccounting.applyStock(plan);
          if (prefill?.cartRows) S.cart = S.cart.filter(line => !prefill.cartRows.includes(line));
          if (!S.cart.length) { S.cartDisc = 0; S.cartDiscType = 'percent'; }
          Cart.render();
          this._prefill = null; window._loanPrefill = null;
          Modal.close('loanNewModal');
          this._activeCustomerId = custId;
          await loadAll();
          toast('Loan created', 'success');
          return true;
        } catch (error) { toast('Loan could not be saved: ' + error.message, 'error'); return false; }
        finally { this._busy = false; }
      },
      openPayment(loanId) {
        const loan = this._loans.find(l => l.id === loanId); if (!loan) return;
        const cur = S.settings.currency;
        const remaining = this._remaining(loan);
        document.getElementById('loanPayBody').innerHTML = `
      <div style="margin-bottom:14px;padding:10px;background:var(--glass);border-radius:var(--r8);">
        <div style="font-size:13px;font-weight:700;">${esc(loan.description || 'Loan')}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:4px;">Remaining: <strong style="color:var(--red)">${cur} ${remaining.toFixed(2)}</strong></div>
      </div>
      <div class="form-group"><label>Payment Amount (${cur}) *</label><input id="lpAmt" type="number" min="0.01" step="0.5" max="${remaining}" placeholder="${remaining.toFixed(2)}" autofocus inputmode="decimal"></div>
      <div class="form-group"><label>Note (optional)</label><input id="lpNote" type="text" placeholder="e.g. Cash, Bank transfer..." inputmode="text"></div>
      <div class="form-group"><label>Date</label><input id="lpDate" type="date" value="${localBusinessDate()}"></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="Modal.close('loanPayModal')">Cancel</button>
        <button class="btn btn-success" onclick="LoanMgr.recordPayment('${loanId}')">✅ Record Payment</button>
      </div>`;
        Modal.open('loanPayModal');
        const lpAmt = document.getElementById('lpAmt');
        if (lpAmt) lpAmt.focus();
      },

      async recordPayment(loanId) {
        const amount = Number(document.getElementById('lpAmt').value);
        const note = document.getElementById('lpNote').value.trim();
        const date = document.getElementById('lpDate').value || localBusinessDate();
        const saved = await this._applyPayment(loanId, amount, note, date);
        if (saved) Modal.close('loanPayModal');
      },
      async markInstallmentPaid(loanId, idx) {
        const loan = this._loans.find(record => record.id === loanId); if (!loan) return false;
        const schedule = this._paymentSchedule(loan, this._paid(loan));
        const installment = schedule[idx]; if (!installment || installment.paid) return false;
        const amount = Math.min(this._remaining(loan), SaleAccounting.money(Number(installment.amount) - Number(installment.paidAmount || 0)));
        return this._applyPayment(loanId, amount, 'Installment ' + (idx + 1) + ' paid', localBusinessDate(), idx);
      },
      async markCleared(loanId) {
        if (!confirm('Mark this loan as fully cleared?')) return false;
        const loan = this._loans.find(record => record.id === loanId); if (!loan) return false;
        return this._applyPayment(loanId, this._remaining(loan), 'Final payment — loan cleared', localBusinessDate());
      },
      async clearLoan(loanId) {
        if (!confirm('Remove this loan record permanently?')) return;
        await DB.del('loans/' + loanId);
        toast('Loan removed', 'info');
        await loadAll();
      },
      _paymentSchedule(loan, paidAmount) {
        const schedule = loan.installments || [];
        const scheduled = SaleAccounting.money(schedule.reduce((sum, installment) => sum + this._num(installment.amount), 0));
        const initial = Math.max(0, SaleAccounting.money(this._total(loan) - scheduled));
        let available = Math.max(0, SaleAccounting.money(paidAmount - initial));
        const allocations = schedule.map(installment => {
          const amount = Math.max(0, this._num(installment.amount));
          const recorded = installment.paidAmount == null ? (installment.paid ? amount : 0) : this._num(installment.paidAmount);
          const paid = Math.min(amount, available, Math.max(0, recorded));
          available = SaleAccounting.money(Math.max(0, available - paid));
          return paid;
        });
        return schedule.map((installment, index) => {
          const amount = Math.max(0, this._num(installment.amount));
          const extra = Math.min(Math.max(0, amount - allocations[index]), available);
          const paid = SaleAccounting.money(allocations[index] + extra);
          available = SaleAccounting.money(Math.max(0, available - extra));
          const complete = paid >= amount;
          return { ...installment, paidAmount: paid, paid: complete, paidDate: complete ? (installment.paidDate || localBusinessDate()) : null };
        });
      },
      async _applyPayment(loanId, value, note, date, installmentIndex = null) {
        if (this._busy) return false;
        const loan = this._loans.find(record => record.id === loanId); if (!loan) return false;
        const amount = SaleAccounting.money(value);
        const remaining = SaleAccounting.money(this._remaining(loan));
        if (!Number.isFinite(Number(value)) || amount <= 0 || amount > remaining) { toast('Payment must be greater than zero and within the remaining balance', 'error'); return false; }
        const paymentDate = new Date(date + 'T12:00:00Z');
        if (!Number.isFinite(paymentDate.getTime())) { toast('Enter a valid payment date', 'error'); return false; }
        this._busy = true;
        try {
          const paidAmount = SaleAccounting.money(this._paid(loan) + amount);
          const paymentHistory = [...(loan.paymentHistory || []), { date: paymentDate.toISOString(), amount, note }];
          const schedule = this._paymentSchedule(loan, this._paid(loan));
          if (installmentIndex !== null && schedule[installmentIndex]) schedule[installmentIndex].paidAmount = SaleAccounting.money(schedule[installmentIndex].paidAmount + amount);
          const installments = this._paymentSchedule({ ...loan, installments: schedule }, paidAmount);
          const patch = { paidAmount, paymentHistory, installments, status: paidAmount >= this._total(loan) ? 'cleared' : 'active' };
          await DB.batch([{ type: 'patch', path: 'loans/' + loanId, data: patch, expected: { paidAmount: loan.paidAmount || 0, paymentHistory: loan.paymentHistory || [] } }]);
          Object.assign(loan, patch);
          await loadAll();
          toast(S.settings.currency + ' ' + amount.toFixed(2) + ' payment recorded', 'success');
          return true;
        } catch (error) { toast('Payment could not be saved: ' + error.message, 'error'); return false; }
        finally { this._busy = false; }
      },

    };

    const Admin = {
      unlock() { const pin = document.getElementById('pinInput').value; if (pin === S.settings.adminPin) { S.adminUnlocked = true; document.getElementById('adminLock').style.display = 'none'; this.render(); toast('Admin unlocked 🔓', 'success'); } else { toast('Wrong PIN ❌', 'error'); document.getElementById('pinInput').value = ''; } },
      lock() { S.adminUnlocked = false; document.getElementById('adminLock').style.display = 'flex'; document.getElementById('pinInput').value = ''; },
      getSales() { const p = document.getElementById('adminPeriod')?.value || 'month'; const now = new Date(); return S.sales.filter(s => { const d = new Date(s.date); if (p === 'today') return d.toDateString() === now.toDateString(); if (p === 'week') { const w = new Date(now); w.setDate(w.getDate() - 7); return d >= w; } if (p === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); return true; }); },
      render() {
        if (!S.adminUnlocked) return;
        const cur = S.settings.currency; const sales = this.getSales();
        const total = sales.reduce((a, s) => a + (s.total || 0), 0);
        const profit = sales.reduce((a, s) => a + (Number(s.profit) || 0), 0);
        const estimated = sales.some(sale => sale.costEstimated);
        const profitLabel = estimated ? 'Estimated gross profit' : 'Gross profit';
        const stv = S.items.reduce((a, i) => a + getStock(i) * (i.costPrice || 0), 0);
        const lowC = S.items.filter(i => getStock(i) <= (i.lowStockThreshold ?? S.settings.lowStockAlert)).length;
        document.getElementById('statsRow').innerHTML = `
      <div class="stat-card"><div class="stat-lbl">💰 Revenue</div><div class="stat-val text-cyan">${cur} ${total.toFixed(2)}</div><div class="stat-sub">${sales.length} sales</div></div>
      <div class="stat-card"><div class="stat-lbl">${profitLabel}</div><div class="stat-val ${profit >= 0 ? 'text-green' : 'text-red'}">${cur} ${profit.toFixed(2)}</div><div class="stat-sub">${total > 0 ? (profit / total * 100).toFixed(1) : 0}% margin</div></div>
      <div class="stat-card"><div class="stat-lbl">🏪 Stock Value</div><div class="stat-val text-purple">${cur} ${stv.toFixed(2)}</div><div class="stat-sub">${S.items.length} products</div></div>
      <div class="stat-card"><div class="stat-lbl">⚠️ Low Stock</div><div class="stat-val text-orange">${lowC}</div><div class="stat-sub">Need restock</div></div>
      <div class="stat-card"><div class="stat-lbl">📦 Categories</div><div class="stat-val text-cyan">${S.categories.length}</div><div class="stat-sub">Product groups</div></div>
      <div class="stat-card"><div class="stat-lbl">🛒 Avg Sale</div><div class="stat-val">${cur} ${sales.length ? (total / sales.length).toFixed(2) : '0.00'}</div><div class="stat-sub">Per transaction</div></div>`;
        // Top items
        const ic = {}; sales.forEach(s => s.items?.forEach(si => { ic[si.itemId] = (ic[si.itemId] || 0) + (si.qty || 1); }));
        const top = Object.entries(ic).sort((a, b) => b[1] - a[1]).slice(0, 6); const mx = top[0]?.[1] || 1;
        document.getElementById('topItems').innerHTML = top.length ? top.map(([id, qty], i) => { const nm = S.items.find(it => it.id === id)?.name || id.slice(-6); return `<div class="top-row"><div class="top-rank">${i + 1}</div><div class="top-name">${esc(nm)}</div><div class="top-bar"><div class="top-bar-fill" style="width:${(qty / mx * 100).toFixed(0)}%"></div></div><div class="top-count">${qty.toFixed(1)}</div></div>`; }).join('') : `<div style="color:var(--t3);text-align:center;padding:14px">No data yet</div>`;
        // Low stock
        const li = S.items.filter(i => getStock(i) <= (i.lowStockThreshold ?? S.settings.lowStockAlert));
        document.getElementById('lowStockDiv').innerHTML = li.length ? li.map(item => `<div class="low-item-row"><div><div style="font-size:12px;font-weight:700">${esc(item.name)}</div><div style="font-size:10px;color:var(--t3)">${getStock(item).toFixed(2)} ${item.unit || ''}</div></div><span class="badge badge-${getStock(item) <= 0 ? 'red' : 'orange'}">${getStock(item) <= 0 ? 'Out' : 'Low'}</span></div>`).join('') : `<div style="color:var(--t3);text-align:center;padding:14px">All OK ✅</div>`;
        // Recent sales
        const rc = this.getSales().slice(0, 15);
        document.getElementById('salesDiv').innerHTML = rc.length ? rc.map(s => { const d = new Date(s.date); const ts = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); const ds = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); const wsc = (s.items || []).filter(i => i.saleMode === 'wholesale').length; return `<div class="sale-row" onclick="SaleDetail.show('${s.id}')"><div class="sale-row-info"><strong>${ds}, ${ts}</strong><div style="font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--t3);">${s.billId || ('#' + (s.id || '').slice(-8))}</div>${(s.items || []).length} items${wsc ? ` (${wsc} wholesale)` : ''} ${s.status === 'returned' ? '<span class="badge badge-red">Returned</span>' : ''}</div><div class="sale-row-amt"><div class="total">${cur} ${(s.total || 0).toFixed(2)}</div><div class="profit">+${cur} ${(s.profit || 0).toFixed(2)}</div></div></div>`; }).join('') : `<div style="color:var(--t3);text-align:center;padding:20px">No sales in this period</div>`;
      },

      searchBill() {
        const q = (document.getElementById('billSearchInput')?.value || '').trim().toUpperCase();
        const el = document.getElementById('billSearchResult'); if (!el) return;
        if (!q) { el.innerHTML = ''; return; }
        const matches = S.sales.filter(s => (s.billId || '').toUpperCase().includes(q) || (s.id || '').toUpperCase().includes(q));
        if (!matches.length) { el.innerHTML = `<div style="font-size:12px;color:var(--red);padding:8px 0;">No bill found for "${q}"</div>`; return; }
        const cur = S.settings.currency;
        el.innerHTML = `<div style="font-size:11px;color:var(--cyan);font-weight:700;margin-bottom:4px;">${matches.length} result(s):</div>` +
          matches.slice(0, 5).map(s => {
            const d = new Date(s.date).toLocaleString('en-GB');
            return `<div class="sale-row" onclick="SaleDetail.show('${s.id}')" style="border-color:rgba(0,212,255,0.3);margin-bottom:5px;">
          <div class="sale-row-info"><strong style="font-family:'JetBrains Mono',monospace;">${s.billId || s.id}</strong><div style="font-size:11px;">${d}</div></div>
          <div class="sale-row-amt"><div class="total">${cur} ${(s.total || 0).toFixed(2)}</div>${s.status === 'returned' ? '<div style="font-size:10px;color:var(--red)">RETURNED</div>' : ''}</div>
        </div>`;
          }).join('');
      }
    };

    const SaleDetail = {
      show(id) {
        const sale = S.sales.find(s => s.id === id); if (!sale) return;
        const cur = S.settings.currency;
        const returned = this._returnedQuantities(sale);
        const isReturned = sale.status === 'return' || !(sale.items || []).some((line, index) => Number(line.qty) > returned[index] + 0.0000001);
        document.getElementById('saleBody').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:800;color:var(--cyan);">${sale.billId || ('Sale #' + (sale.id || '').slice(-8))}</div>
          <div style="color:var(--t2);font-size:12px;margin-top:2px;">🕐 ${new Date(sale.date).toLocaleString('en-GB')}</div>
          ${isReturned ? `<div class="badge badge-red" style="margin-top:4px;">↩ Returned ${sale.returnedAt ? new Date(sale.returnedAt).toLocaleDateString() : ''}</div>` : ''}
        </div>
        ${!isReturned ? `<button class="btn btn-danger btn-sm" onclick="SaleDetail.openReturn('${id}')">↩ Return</button>` : ''}
      </div>
      ${(sale.items || []).map(si => {
          const ws = si.saleMode === 'wholesale';
          const profit = S.adminUnlocked ? (si.price - (si.costPrice || 0) * si.qty) : null;
          return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:700;font-size:13px">${esc(si.name)}${ws ? ' <span class="badge badge-purple">WS</span>' : ''}</div>
            <div style="font-size:11px;color:var(--t3)">${si.qty} ${si.unit} × ${cur} ${si.unitPrice?.toFixed(2) || 0}</div>
            ${S.adminUnlocked && si.costPrice ? `<div style="font-size:10px;color:var(--t3)">Cost: ${cur} ${(si.costPrice * si.qty).toFixed(2)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${ws ? 'var(--purple)' : 'var(--cyan)'};">${cur} ${(si.price || 0).toFixed(2)}</div>
            ${S.adminUnlocked && profit != null ? `<div style="font-size:10px;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};">+${cur}${profit.toFixed(2)}</div>` : ''}
          </div>
        </div>`;
        }).join('')}
      <div style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>Subtotal</span><span>${cur} ${(sale.subtotal || 0).toFixed(2)}</span></div>
        ${sale.cartDiscount > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--green);font-size:13px"><span>Discount</span><span>-${cur} ${sale.cartDiscount.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;border-top:1px solid var(--border);margin-top:4px;padding-top:6px"><span>Total</span><span class="text-cyan">${cur} ${(sale.total || 0).toFixed(2)}</span></div>
        ${S.adminUnlocked ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--green)"><span>${sale.costEstimated ? 'Estimated gross profit' : 'Gross profit'}</span><span>${cur} ${(sale.profit || 0).toFixed(2)}</span></div>` : ''}
      </div>
      ${sale.receiptText ? `<details style="margin-top:12px;"><summary style="font-size:11px;color:var(--t3);cursor:pointer;">📄 Receipt Text</summary><pre style="font-size:10px;color:var(--t2);margin-top:6px;background:var(--bg3);padding:8px;border-radius:var(--r8);overflow-x:auto;white-space:pre-wrap;">${esc(sale.receiptText)}</pre></details>` : ''}`;
        Modal.open('saleModal');
      },

      openReturn(saleId) {
        const sale = S.sales.find(record => record.id === saleId); if (!sale || sale.status === 'return') return;
        const returned = this._returnedQuantities(sale);
        const netAmounts = SaleAccounting.netAmounts(sale);
        const cur = S.settings.currency;
        document.getElementById('discTitle').textContent = 'Return / Refund';
        document.getElementById('discBody').innerHTML = `<div style="margin-bottom:12px;font-weight:700">${esc(sale.billId || saleId)}</div><div style="font-size:12px;margin-bottom:8px">Select items and quantities to return</div>${(sale.items || []).map((line, i) => {
          const remaining = Math.max(0, Number(line.qty) - returned[i]);
          if (remaining < 0.0000001) return '';
          const refundable = SaleAccounting.money(netAmounts[i] - SaleAccounting.money(netAmounts[i] * returned[i] / Number(line.qty)));
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)"><input type="checkbox" class="ret-chk" data-idx="${i}" checked style="width:auto"><div style="flex:1;font-size:12px"><strong>${esc(line.name)}</strong><br>${remaining} ${esc(line.unit || '')} · ${esc(cur)} ${refundable.toFixed(2)}</div><input type="number" class="ret-qty" data-idx="${i}" value="${remaining}" min="0.001" max="${remaining}" step="0.001" style="width:70px"></div>`;
        }).join('')}<div class="form-group" style="margin-top:12px"><label>Reason</label><input id="retReason" type="text" placeholder="Reason for return"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="Modal.close('discModal')">Cancel</button><button class="btn btn-danger" onclick="SaleDetail.processReturn('${saleId}')">Refund</button><button class="btn btn-primary" onclick="SaleDetail.processReturn('${saleId}', 'exchange')">Exchange credit</button></div>`;
        Modal.open('discModal');
      },
      async processReturn(saleId, mode = 'refund') {
        if (this._busy) return false;
        const sale = S.sales.find(record => record.id === saleId);
        if (!sale || sale.status === 'return') return false;
        this._busy = true;
        try {
          const reason = document.getElementById('retReason')?.value.trim() || 'No reason';
          const previous = this._returnedQuantities(sale);
          const netAmounts = SaleAccounting.netAmounts(sale);
          const returnItems = [];
          let refundTotal = 0;
          let costTotal = 0;
          for (const checkbox of document.querySelectorAll('.ret-chk:checked')) {
            const index = Number(checkbox.dataset.idx);
            const line = sale.items[index]; if (!line) throw new Error('Select a valid sale item');
            const input = Array.from(document.querySelectorAll('.ret-qty')).find(element => Number(element.dataset.idx) === index);
            const qty = Number(input?.value);
            const remaining = Math.max(0, Number(line.qty) - previous[index]);
            if (!Number.isFinite(qty) || qty <= 0 || qty - remaining > 0.0000001) throw new Error('Enter a return quantity within the remaining amount for ' + line.name);
            const item = S.items.find(product => product.id === line.itemId);
            if ((item?.type === 'unit' || (!item && line.unit === 'pcs')) && !Number.isInteger(qty)) throw new Error(line.name + ' requires a whole return quantity');
            const cumulative = Math.min(Number(line.qty), previous[index] + qty);
            const refund = SaleAccounting.money(SaleAccounting.money(netAmounts[index] * cumulative / Number(line.qty)) - SaleAccounting.money(netAmounts[index] * previous[index] / Number(line.qty)));
            const lineCost = Number.isFinite(Number(line.costTotal)) ? Number(line.costTotal) : Math.max(0, Number(line.costPrice) || 0) * Number(line.qty);
            const cost = SaleAccounting.money(SaleAccounting.money(lineCost * cumulative / Number(line.qty)) - SaleAccounting.money(lineCost * previous[index] / Number(line.qty)));
            returnItems.push({ ...line, sourceIndex: index, returnQty: qty, refundAmount: refund, returnedCost: cost });
            refundTotal += refund; costTotal += cost;
          }
          refundTotal = SaleAccounting.money(refundTotal); costTotal = SaleAccounting.money(costTotal);
          if (!returnItems.length) throw new Error('Select at least one item');
          if (!confirm('Return ' + returnItems.length + ' item(s) for a refund of ' + S.settings.currency + ' ' + refundTotal.toFixed(2) + '?')) return false;
          const products = new Map();
          for (const line of returnItems) {
            if (SaleAccounting.isCustom(line)) continue;
            const item = S.items.find(product => product.id === line.itemId); if (!item) continue;
            let entry = products.get(item.id);
            if (!entry) { entry = { item, original: JSON.parse(JSON.stringify(item.stockBatches || [])), batches: SaleAccounting.batches(item.stockBatches), qty: 0, cost: 0, barcodes: [] }; products.set(item.id, entry); }
            entry.qty += line.returnQty; entry.cost += line.returnedCost;
            if (line.serialCode && line.returnQty === 1 && line.qty === 1) entry.barcodes.push(line.serialCode);
          }
          const id = DB.newId();
          const operations = Array.from(products.values(), entry => {
            const batch = { batchId: 'ret_' + id, quantity: entry.qty, costPrice: entry.qty ? entry.cost / entry.qty : 0, dateAdded: localBusinessDate() };
            if (entry.barcodes.length) batch.barcodes = entry.barcodes;
            entry.batches.push(batch);
            return { type: 'patch', path: 'items/' + entry.item.id, data: { stockBatches: entry.batches }, expected: { stockBatches: entry.original } };
          });
          const allReturns = [...(sale.returnItems || []), ...returnItems];
          const quantities = [...previous];
          returnItems.forEach(line => { quantities[line.sourceIndex] += line.returnQty; });
          const fullyReturned = (sale.items || []).every((line, i) => quantities[i] >= Number(line.qty) - 0.0000001);
          const patch = { status: fullyReturned ? 'returned' : 'partial_return', returnedAt: new Date().toISOString(), returnReason: reason, returnItems: allReturns, refundTotal: SaleAccounting.money((Number(sale.refundTotal) || 0) + refundTotal) };
          operations.push({ type: 'patch', path: 'sales/' + saleId, data: patch, expected: { returnItems: sale.returnItems || [], refundTotal: sale.refundTotal || 0 } });
          const retSale = { billId: 'RET-' + (sale.billId || saleId.slice(-8)) + '-' + id.slice(-5), date: new Date().toISOString(), items: returnItems.map(line => ({ ...line, qty: line.returnQty, price: -line.refundAmount, costTotal: line.returnedCost })), subtotal: -refundTotal, cartDiscount: 0, total: -refundTotal, profit: SaleAccounting.money(costTotal - refundTotal), payMethod: mode === 'exchange' ? 'exchange' : sale.payMethod || 'cash', exchangeCreditRemaining: mode === 'exchange' ? refundTotal : 0, cashReceived: mode === 'exchange' ? 0 : -refundTotal, changeDue: 0, status: 'return', returnOf: saleId, reason, receiptText: 'RETURN — ' + (sale.billId || saleId) + '\nReason: ' + reason + '\nRefund: ' + S.settings.currency + refundTotal.toFixed(2) };
          operations.push({ type: 'set', path: 'sales/' + id, data: retSale });
          await DB.batch(operations);
          for (const entry of products.values()) entry.item.stockBatches = entry.batches;
          Object.assign(sale, patch);
          Modal.close('discModal'); Modal.close('saleModal');
          await loadAll();
          if (mode === 'exchange') ExchangeCredits.add(id);
          else toast('Return processed — refund ' + S.settings.currency + ' ' + refundTotal.toFixed(2), 'success');
          return true;
        } catch (error) { toast('Return could not be processed: ' + error.message, 'error'); return false; }
        finally { this._busy = false; }
      },

      _returnedQuantities(sale) {
        const items = sale.items || [];
        const quantities = items.map(() => 0);
        if (sale.status === 'returned' && !sale.returnItems?.length) return items.map(line => Math.max(0, Number(line.qty) || 0));
        for (const returned of sale.returnItems || []) {
          let remaining = Math.max(0, Number(returned.returnQty) || 0);
          const hasIndex = Number.isInteger(returned.sourceIndex) && returned.sourceIndex >= 0 && returned.sourceIndex < items.length;
          for (let i = 0; i < items.length && remaining > 0; i++) {
            if (hasIndex ? i !== returned.sourceIndex : items[i].itemId !== returned.itemId) continue;
            const used = Math.min(remaining, Math.max(0, Number(items[i].qty) - quantities[i]));
            quantities[i] += used; remaining -= used;
          }
        }
        return quantities;
      },

    };
