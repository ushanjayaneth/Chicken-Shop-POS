const CoconutMgr = {
      _tab: 'summary',
      _selectedDate: '',
      _summaryDate: '',
      _mutationPending: false,

      _today(date = new Date()) {
        if (typeof localBusinessDate === 'function') return localBusinessDate(date);
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      },

      _value(value) {
        const number = Number(value || 0);
        return Number.isFinite(number) ? number : 0;
      },

      _round(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER / 100) {
          throw new Error('Amount is outside the supported range');
        }
        return Math.round((number + Number.EPSILON) * 100) / 100;
      },

      _previewNumber(id) {
        return Math.max(0, this._value(document.getElementById(id)?.value));
      },

      _number(id, label, integer = false) {
        const value = Number(document.getElementById(id)?.value || 0);
        if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) {
          throw new Error(label + (integer ? ' must be a nonnegative whole number' : ' must be a nonnegative, finite number'));
        }
        return value;
      },

      _amount(id, label) {
        return this._round(this._number(id, label));
      },

      _date(id) {
        const value = document.getElementById(id)?.value || '';
        const parsed = new Date(value + 'T12:00:00');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || this._today(parsed) !== value) {
          throw new Error('Please select a valid date');
        }
        return value;
      },

      _paymentMethod(id, allowed) {
        const value = document.getElementById(id)?.value;
        if (!allowed.includes(value)) throw new Error('Please select a valid payment method');
        return value;
      },

      _worker(id) {
        const worker = S.coconut_workers.find(record => record.id === id);
        if (!worker) throw new Error('Please select or register a worker first');
        return worker;
      },

      _validateItemized(largeCount, smallCount, largePrice, smallPrice) {
        if (largeCount + smallCount <= 0) throw new Error('Please enter a large or small coconut count');
        if ((largeCount > 0 && largePrice <= 0) || (smallCount > 0 && smallPrice <= 0)) {
          throw new Error('Please enter a positive price for each coconut size used');
        }
      },

      _withinTotal(amount, total, label) {
        if (amount - total > 0.000001) throw new Error(label + ' cannot exceed ' + this._money(total));
      },

      _hasCopraYield(record) {
        return record.copraKg !== undefined && record.copraKg !== null && record.copraKg !== ''
          && Number.isFinite(Number(record.copraKg)) && Number(record.copraKg) > 0;
      },

      _workerOutstanding(workerId, asOfDate = '', excludedHuskingId = '') {
        const included = record => !asOfDate || !record.date || String(record.date).slice(0, 10) <= asOfDate;
        const husking = S.coconut_husking.filter(record => record.workerId === workerId
          && record.id !== excludedHuskingId && included(record));
        const payments = S.coconut_worker_payments.filter(record => record.workerId === workerId && included(record));
        const earned = husking.reduce((total, record) => total + this._value(record.total) - this._value(record.paidDrawer), 0);
        return this._round(earned - payments.reduce((total, record) => total + this._value(record.amount), 0));
      },

      _requireStock(required, date) {
        const dated = this.calcStock(date);
        const current = this.calcStock();
        const labels = {
          rawLargeStock: 'raw large coconuts', rawSmallStock: 'raw small coconuts',
          peeledStock: 'peeled coconuts', husksStock: 'coconut husks',
          copraStock: 'copra (kg)', oilStock: 'coconut oil (L)', poonacStock: 'poonac (kg)'
        };
        Object.entries(required).forEach(([field, quantity]) => {
          if (field === 'copraStock' && quantity > 0 && (!dated.copraStockKnown || !current.copraStockKnown)) {
            throw new Error('Record the measured output for older copra batches before using or selling copra.');
          }
          const available = Math.max(0, Math.min(dated[field], current[field]));
          if (quantity - available > 0.000001) {
            throw new Error(`Insufficient ${labels[field]}. Available ${available.toLocaleString('en-GB')} for the selected date.`);
          }
        });
      },

      _validateStockRemoval(collection, id) {
        const record = S[collection].find(entry => entry.id === id);
        if (!record) throw new Error('Record not found');
        const collections = ['coconut_purchases', 'coconut_husking', 'coconut_copra', 'coconut_oil', 'coconut_sales'];
        const dates = new Set([this._today()]);
        collections.forEach(name => S[name].forEach(entry => {
          const date = String(entry.date || '').slice(0, 10);
          if (date) dates.add(date);
        }));
        S.coconut_worker_payments.forEach(entry => {
          const date = String(entry.date || '').slice(0, 10);
          if (date) dates.add(date);
        });
        const fields = ['rawLargeStock', 'rawSmallStock', 'peeledStock', 'husksStock', 'copraStock', 'oilStock', 'poonacStock'];
        dates.forEach(date => {
          const before = this.calcStock(date);
          const after = this.calcStock(date, collection + '/' + id);
          fields.forEach(field => {
            if (field === 'copraStock' && (!before.copraStockKnown || !after.copraStockKnown)) return;
            if (after[field] < Math.min(0, before[field]) - 0.000001) {
              throw new Error('This record supplies stock used by a later transaction. Remove the dependent transaction first.');
            }
          });
          if (collection === 'coconut_husking' && record.workerId) {
            const previousDue = this._workerOutstanding(record.workerId, date);
            const remainingDue = this._workerOutstanding(record.workerId, date, id);
            if (remainingDue < Math.min(0, previousDue) - 0.000001) {
              throw new Error('This work record has wage payments against it. Remove or correct those payments before deleting the work record.');
            }
          }
        });
      },

      async _saveRecord(collection, data, movements = []) {
        const id = DB.newId();
        const operations = [{ type: 'set', path: collection + '/' + id, data }];
        movements.forEach(movement => operations.push({
          type: 'set', path: 'cash_movements/' + DB.newId(),
          data: { ...movement, date: data.date + 'T12:00:00.000Z', refId: id, createdAt: data.createdAt }
        }));
        await DB.batch(operations);
        return id;
      },

      async _deleteRecord(collection, id, sources = []) {
        if (!S[collection].some(record => record.id === id)) throw new Error('Record not found');
        const movements = S.cash_movements.filter(movement => movement.refId === id && sources.includes(movement.source));
        await DB.batch([
          { type: 'del', path: collection + '/' + id },
          ...movements.map(movement => ({ type: 'del', path: 'cash_movements/' + movement.id }))
        ]);
      },

      _drawerTotals(date) {
        const dayRecords = collection => S[collection].filter(record => String(record.date || '').slice(0, 10) === date);
        const movements = S.cash_movements || [];
        const dayMovements = movements.filter(record => String(record.date || '').slice(0, 10) === date);
        const sum = (rows, field) => rows.reduce((total, record) => total + this._value(record[field]), 0);
        const linkedAmount = (collection, source, field, type, paymentMethod = '') => {
          const linkedIds = new Set(movements.filter(record => record.source === source).map(record => record.refId));
          const legacy = dayRecords(collection).filter(record => !linkedIds.has(record.id) && (!paymentMethod || record.payMethod === paymentMethod));
          const ledger = dayMovements.filter(record => record.source === source && record.type === type);
          return sum(ledger, 'amount') + sum(legacy, field);
        };
        const totals = {
          drawBuyOut: linkedAmount('coconut_purchases', 'coconut_buy', 'paidDrawer', 'out', 'cash'),
          drawHuskOut: linkedAmount('coconut_husking', 'coconut_husk', 'paidDrawer', 'out'),
          drawCopraOut: linkedAmount('coconut_copra', 'coconut_copra', 'paidDrawer', 'out'),
          drawOilOut: linkedAmount('coconut_oil', 'coconut_oil', 'paidDrawer', 'out'),
          drawSalesIn: linkedAmount('coconut_sales', 'coconut_sale', 'recDrawer', 'in', 'cash'),
          drawWorkerPayOut: linkedAmount('coconut_worker_payments', 'coconut_worker_pay', 'paidDrawer', 'out'),
          drawSaleTransOut: linkedAmount('coconut_sales', 'coconut_sale_transport', 'transportPaidDrawer', 'out'),
          drawManualIn: sum(dayMovements.filter(record => record.source === 'coconut_drawer_in' && record.type === 'in'), 'amount'),
          drawManualOut: sum(dayMovements.filter(record => record.source === 'coconut_drawer_out' && record.type === 'out'), 'amount'),
          dayExpenses: dayMovements.filter(record => record.source === 'coconut_expense'),
          savedFloat: this._value(S.settings.coconutOpeningFloats?.[date])
        };
        totals.drawExpensesOut = sum(totals.dayExpenses, 'amount');
        totals.expectedCash = this._round(totals.savedFloat + totals.drawSalesIn + totals.drawManualIn
          - totals.drawBuyOut - totals.drawHuskOut - totals.drawCopraOut - totals.drawOilOut
          - totals.drawWorkerPayOut - totals.drawSaleTransOut - totals.drawExpensesOut - totals.drawManualOut);
        return totals;
      },

      init() {
        const today = this._today();
        const dateEl = document.getElementById('coconutDate');
        if (dateEl && !dateEl.value) dateEl.value = today;
        const startEl = document.getElementById('ccPLStartDate');
        if (startEl && !startEl.value) {
          const start = new Date();
          start.setDate(start.getDate() - 30);
          startEl.value = this._today(start);
        }
        const endEl = document.getElementById('ccPLEndDate');
        if (endEl && !endEl.value) endEl.value = today;
        const buyMethod = document.getElementById('ccBuyPayMethod');
        const saleMethod = document.getElementById('ccSalePayMethod');
        if (buyMethod) buyMethod.onchange = () => this.calcBuyTotal();
        if (saleMethod) saleMethod.onchange = () => this.calcSaleTotal();
      },

      switchTab(tab) {
        this._tab = tab;
        ['summary', 'buy', 'processing', 'sale', 'payroll'].forEach(name => {
          const button = document.getElementById('ccTab_' + name);
          const section = document.getElementById('ccSection_' + name);
          if (button) button.classList.toggle('active', name === tab);
          if (section) section.style.display = name === tab ? 'block' : 'none';
        });
        const selectedDate = document.getElementById('coconutDate')?.value || this._today();
        const dateChanged = this._selectedDate !== selectedDate;
        this._selectedDate = selectedDate;
        ['ccBuyDate', 'ccHuskDate', 'ccCopraDate', 'ccOilDate', 'ccSaleDate', 'ccPayDate'].forEach(id => {
          const input = document.getElementById(id);
          if (input && (dateChanged || !input.value)) input.value = selectedDate;
        });
        if (tab === 'summary') {
          this.renderSummary();
          this.renderPLReport();
        } else if (tab === 'buy') {
          this.calcBuyTotal(false);
          this.renderBuyList();
        } else if (tab === 'processing') {
          this.updateWorkerDropdowns();
          this.calcHuskTotal(false);
          this.calcCopraTotal();
          this.renderProcessingLists();
        } else if (tab === 'sale') {
          this.updateSaleLabels(false);
          this.renderSaleList();
        } else if (tab === 'payroll') {
          this.updateWorkerDropdowns();
          this.renderPayroll();
        }
      },

      calcStock(asOfDate = '', excludedPath = '') {
        const records = name => (S[name] || []).filter(record => {
          const recordDate = String(record.date || '').slice(0, 10);
          return name + '/' + record.id !== excludedPath && (!asOfDate || !recordDate || recordDate <= asOfDate);
        });
        const purchases = records('coconut_purchases');
        const husking = records('coconut_husking');
        const copra = records('coconut_copra');
        const oil = records('coconut_oil');
        const sales = records('coconut_sales');
        const sum = (rows, field) => rows.reduce((total, row) => total + this._value(row[field]), 0);
        const rawLargePurchased = sum(purchases, 'largeCount');
        const rawSmallPurchased = sum(purchases, 'smallCount');
        let rawLargeHusked = 0;
        let rawSmallHusked = 0;
        husking.forEach(record => {
          const large = this._value(record.largeCount);
          const small = this._value(record.smallCount);
          rawLargeHusked += large || small ? large : this._value(record.count);
          rawSmallHusked += small;
        });
        const saleCount = (type, field) => sales.filter(sale => sale.type === type).reduce((total, sale) => {
          const large = this._value(sale.largeCount);
          const small = this._value(sale.smallCount);
          if (field === 'largeCount' && !large && !small) return total + this._value(sale.qty);
          return total + this._value(sale[field]);
        }, 0);
        const rawLargeSold = saleCount('unhusked', 'largeCount');
        const rawSmallSold = saleCount('unhusked', 'smallCount');
        const totalPeeledSold = saleCount('husked', 'largeCount') + saleCount('husked', 'smallCount');
        const peeledCopraUsed = sum(copra, 'nutsUsed');
        const totalHusked = rawLargeHusked + rawSmallHusked;
        const copraUnknownBatches = copra.filter(record => !this._hasCopraYield(record)).length;
        const copraProducedKg = sum(copra.filter(record => this._hasCopraYield(record)), 'copraKg');
        const copraSoldKg = saleCount('copra', 'qty');
        const oilSoldL = saleCount('oil', 'qty');
        const poonacSoldKg = saleCount('poonac', 'qty');
        return {
          rawLargeStock: rawLargePurchased - rawLargeHusked - rawLargeSold,
          rawSmallStock: rawSmallPurchased - rawSmallHusked - rawSmallSold,
          peeledStock: totalHusked - peeledCopraUsed - totalPeeledSold,
          rawLargePurchased, rawSmallPurchased, rawLargeHusked, rawSmallHusked,
          rawLargeSold, rawSmallSold, peeledCopraUsed, totalPeeledSold,
          husksStock: totalHusked - saleCount('husks', 'qty'),
          shellsSold: saleCount('shells', 'qty'),
          copraSoldKg, oilSoldL, poonacSoldKg, copraProducedKg, copraUnknownBatches,
          copraStockKnown: copraUnknownBatches === 0,
          copraStock: copraProducedKg - sum(oil, 'copraUsed') - copraSoldKg,
          oilStock: sum(oil, 'oilQty') - oilSoldL,
          poonacStock: sum(oil, 'poonacQty') - poonacSoldKg
        };
      },

      calcBuyTotal(updatePayment = true) {
        const total = this._previewNumber('ccBuyLargeCount') * this._previewNumber('ccBuyLargePrice')
          + this._previewNumber('ccBuySmallCount') * this._previewNumber('ccBuySmallPrice')
          + this._previewNumber('ccBuyTransport');
        document.getElementById('ccBuyTotal').textContent = this._money(total);
        const paidInput = document.getElementById('ccBuyPaidDrawer');
        if (paidInput && updatePayment) {
          paidInput.value = document.getElementById('ccBuyPayMethod')?.value === 'cash' ? total.toFixed(2) : '0.00';
        }
      },

      calcHuskTotal(updatePayment = true) {
        const count = this._previewNumber('ccHuskLargeCount') + this._previewNumber('ccHuskSmallCount');
        const total = count * this._previewNumber('ccHuskRate');
        document.getElementById('ccHuskTotal').textContent = this._money(total);
        const paidInput = document.getElementById('ccHuskPaidDrawer');
        if (paidInput && updatePayment) paidInput.value = total.toFixed(2);
      },

      calcCopraTotal() {
        const preview = document.getElementById('ccCopraTotal');
        if (!preview) return;
        const kilograms = this._previewNumber('ccCopraKg');
        const cost = this._previewNumber('ccCopraCost');
        preview.textContent = kilograms > 0
          ? `${kilograms.toLocaleString('en-GB')} kg · Drying cost ${this._money(cost)} · ${this._money(cost / kilograms)}/kg`
          : `Drying cost ${this._money(cost)}`;
      },

      calcSaleTotal(updatePayment = true) {
        const type = document.getElementById('ccSaleType')?.value;
        const itemized = type === 'unhusked' || type === 'husked';
        const total = itemized
          ? this._previewNumber('ccSaleLargeCount') * this._previewNumber('ccSaleLargePrice')
            + this._previewNumber('ccSaleSmallCount') * this._previewNumber('ccSaleSmallPrice')
          : this._previewNumber('ccSaleCount') * this._previewNumber('ccSalePrice');
        document.getElementById('ccSaleTotal').textContent = this._money(total);
        const receivedInput = document.getElementById('ccSaleRecDrawer');
        if (receivedInput && updatePayment) {
          receivedInput.value = document.getElementById('ccSalePayMethod')?.value === 'cash' ? total.toFixed(2) : '0.00';
        }
      },

      updateSaleLabels(updatePayment = true) {
        const type = document.getElementById('ccSaleType')?.value;
        const qtyLbl = document.getElementById('ccSaleQtyLabel');
        const priceLbl = document.getElementById('ccSalePriceLabel');

        const itemizedContainer = document.getElementById('ccSaleItemizedContainer');
        const singleContainer = document.getElementById('ccSaleSingleContainer');

        if (type === 'unhusked' || type === 'husked') {
          if (itemizedContainer) itemizedContainer.style.display = 'block';
          if (singleContainer) singleContainer.style.display = 'none';
        } else {
          if (itemizedContainer) itemizedContainer.style.display = 'none';
          if (singleContainer) singleContainer.style.display = 'block';

          if (qtyLbl && priceLbl) {
            if (type === 'husks') {
              qtyLbl.textContent = 'Quantity (Pcs)';
              priceLbl.textContent = 'Price per Husk (Rs.)';
            } else if (type === 'shells') {
              qtyLbl.textContent = 'Quantity (kg or Pcs)';
              priceLbl.textContent = 'Price per unit (Rs.)';
            } else if (type === 'copra') {
              qtyLbl.textContent = 'Quantity (kg)';
              priceLbl.textContent = 'Price per kg (Rs.)';
            } else if (type === 'oil') {
              qtyLbl.textContent = 'Quantity (Liters)';
              priceLbl.textContent = 'Price per Liter (Rs.)';
            } else if (type === 'poonac') {
              qtyLbl.textContent = 'Quantity (kg)';
              priceLbl.textContent = 'Price per kg (Rs.)';
            }
          }
        }
        this.calcSaleTotal(updatePayment);
      },

      updateWorkerDropdowns() {
        const workers = S.coconut_workers || [];
        const options = workers.map(worker => `<option value="${esc(worker.id)}">${esc(worker.name)}</option>`).join('')
          || '<option value="">-- Register Workers First --</option>';
        ['ccHuskWorkerSelect', 'ccPayWorkerSelect'].forEach(id => {
          const select = document.getElementById(id);
          if (!select) return;
          const selected = select.value;
          select.innerHTML = options;
          if (workers.some(worker => worker.id === selected)) select.value = selected;
        });
      },

      _money(value) {
        return `${S.settings.currency || 'Rs.'} ${this._value(value).toFixed(2)}`;
      },

      _line(label, value, width = 42) {
        const left = String(label || '');
        const right = String(value || '');
        const gap = width - left.length - right.length;
        return gap > 1 ? left + ' '.repeat(gap) + right : `${left}\n${right}`;
      },

      _center(text, width = 42) {
        const value = String(text || '');
        if (value.length >= width) return value;
        return ' '.repeat(Math.floor((width - value.length) / 2)) + value;
      },

      _wrap(text, width = 42) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        words.forEach(word => {
          if (word.length > width) {
            if (line) {
              lines.push(line);
              line = '';
            }
            for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
            return;
          }
          const next = line ? `${line} ${word}` : word;
          if (next.length > width) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        });
        if (line) lines.push(line);
        return lines.length ? lines : [''];
      },

      _payMethodLabel(method) {
        const labels = { cash: 'CASH', card: 'CARD', online: 'ONLINE' };
        const key = String(method || 'cash').toLowerCase();
        return labels[key] || key.toUpperCase();
      },

      _coconutTypeLabel(type) {
        const labels = {
          unhusked: 'Raw Coconuts',
          husked: 'Peeled Coconuts',
          husks: 'Coconut Husks',
          shells: 'Coconut Shells',
          copra: 'Copra',
          oil: 'Coconut Oil',
          poonac: 'Poonac'
        };
        return labels[type] || String(type || 'Coconut Item');
      },

      _buildCoconutPrintDoc({ title, idLabel, id, date, partyLabel, party, payMethod, rows, totals, notes, footer }) {
        const shop = S.settings.shopName || 'Mr. Chicken House';
        const lines = [
          this._center(shop),
          this._center(title),
          '-'.repeat(42),
          this._line(idLabel, id),
          this._line('Date', date),
          this._line(partyLabel, party),
          this._line('Payment', this._payMethodLabel(payMethod)),
          '-'.repeat(42)
        ];
        rows.forEach(row => {
          this._wrap(row.name).forEach(part => lines.push(part));
          lines.push(this._line(row.qtyText, row.amount));
        });
        lines.push('-'.repeat(42));
        totals.forEach(row => lines.push(this._line(row.label, row.value)));
        if (notes) {
          lines.push('-'.repeat(42));
          this._wrap(`Note: ${notes}`).forEach(part => lines.push(part));
        }
        lines.push('');
        lines.push(this._center(footer || 'System Generated Voucher'));

        const rowHtml = rows.map(row => `
          <div class="receipt80-item">
            <div class="receipt80-name">${esc(row.name)}</div>
            <div class="receipt80-calc"><span>${esc(row.qtyText)}</span><strong>${esc(row.amount)}</strong></div>
          </div>`).join('');
        const totalHtml = totals.map(row => `
          <div class="receipt80-line ${row.emphasis ? 'receipt80-total' : ''}">
            <span>${esc(row.label)}</span><strong>${esc(row.value)}</strong>
          </div>`).join('');

        return {
          title,
          text: lines.join('\n'),
          html: `<div class="receipt80">
            <div class="receipt80-head">
              <div class="receipt80-shop">${esc(shop)}</div>
              <div class="receipt80-title">${esc(title)}</div>
            </div>
            <div class="receipt80-row"><span>${esc(idLabel)}</span><strong>${esc(id)}</strong></div>
            <div class="receipt80-row"><span>Date</span><strong>${esc(date)}</strong></div>
            <div class="receipt80-row"><span>${esc(partyLabel)}</span><strong>${esc(party)}</strong></div>
            <div class="receipt80-row"><span>Payment</span><strong>${esc(this._payMethodLabel(payMethod))}</strong></div>
            <div class="receipt80-items">${rowHtml}</div>
            ${totalHtml}
            ${notes ? `<div class="receipt80-note">Note: ${esc(notes)}</div>` : ''}
            <div class="receipt80-foot">${esc(footer || 'System Generated Voucher')}</div>
          </div>`
        };
      },

      buildPurchasePrintDoc(p) {
        const rows = [];
        const largeCount = this._value(p.largeCount);
        const largePrice = this._value(p.largePrice);
        const smallCount = this._value(p.smallCount);
        const smallPrice = this._value(p.smallPrice);
        const transportCost = this._value(p.transportCost);
        if (largeCount > 0) {
          rows.push({
            name: 'Large Coconuts',
            qtyText: `${largeCount} x ${this._money(largePrice)}`,
            amount: this._money(largeCount * largePrice)
          });
        }
        if (smallCount > 0) {
          rows.push({
            name: 'Small Coconuts',
            qtyText: `${smallCount} x ${this._money(smallPrice)}`,
            amount: this._money(smallCount * smallPrice)
          });
        }
        if (transportCost > 0) {
          rows.push({
            name: 'Transport Cost',
            qtyText: '1 x ' + this._money(transportCost),
            amount: this._money(transportCost)
          });
        }
        return this._buildCoconutPrintDoc({
          title: 'Coconut Purchase Voucher',
          idLabel: 'Bill ID',
          id: p.billId || p.id || '',
          date: p.date || '',
          partyLabel: 'Supplier',
          party: p.estate || 'Supplier',
          payMethod: p.payMethod,
          rows,
          totals: [
            { label: 'TOTAL', value: this._money(p.total), emphasis: true },
            { label: 'Paid from Drawer', value: this._money(p.paidDrawer) }
          ],
          notes: p.notes || '',
          footer: 'ShoppingLK POS'
        });
      },

      buildSalePrintDoc(s) {
        const rows = [];
        const transportCost = this._value(s.transportCost);
        if (s.type === 'unhusked' || s.type === 'husked') {
          const typeName = this._coconutTypeLabel(s.type);
          const largeCount = this._value(s.largeCount);
          const largePrice = this._value(s.largePrice);
          const smallCount = this._value(s.smallCount);
          const smallPrice = this._value(s.smallPrice);
          if (largeCount > 0) {
            rows.push({
              name: `${typeName} - Large`,
              qtyText: `${largeCount} x ${this._money(largePrice)}`,
              amount: this._money(largeCount * largePrice)
            });
          }
          if (smallCount > 0) {
            rows.push({
              name: `${typeName} - Small`,
              qtyText: `${smallCount} x ${this._money(smallPrice)}`,
              amount: this._money(smallCount * smallPrice)
            });
          }
          if (largeCount <= 0 && smallCount <= 0 && this._value(s.qty) > 0) {
            rows.push({
              name: typeName,
              qtyText: `${this._value(s.qty)} x ${this._money(s.price)}`,
              amount: this._money(s.total)
            });
          }
        } else {
          const qty = this._value(s.qty);
          const price = this._value(s.price);
          rows.push({
            name: this._coconutTypeLabel(s.type),
            qtyText: `${qty} x ${this._money(price)}`,
            amount: this._money(s.total)
          });
        }
        if (transportCost > 0) {
          rows.push({
            name: 'Transport Cost (paid by us)',
            qtyText: '1 x ' + this._money(transportCost),
            amount: this._money(transportCost)
          });
        }
        return this._buildCoconutPrintDoc({
          title: 'Coconut Wholesale Invoice',
          idLabel: 'Invoice ID',
          id: s.billId || s.id || '',
          date: s.date || '',
          partyLabel: 'Customer',
          party: s.buyer || 'Wholesale Buyer',
          payMethod: s.payMethod,
          rows,
          totals: [
            { label: 'TOTAL', value: this._money(s.total), emphasis: true },
            { label: 'Received to Drawer', value: this._money(s.recDrawer) }
          ],
          notes: s.notes || '',
          footer: 'Thank You! Come Again.'
        });
      },

      async savePurchase() {
        const date = this._date('ccBuyDate');
        const estate = document.getElementById('ccBuyEstate').value.trim();
        if (!estate) throw new Error('Please enter Estate / Supplier');
        const largeCount = this._number('ccBuyLargeCount', 'Large count', true);
        const smallCount = this._number('ccBuySmallCount', 'Small count', true);
        const largePrice = this._amount('ccBuyLargePrice', 'Large price');
        const smallPrice = this._amount('ccBuySmallPrice', 'Small price');
        this._validateItemized(largeCount, smallCount, largePrice, smallPrice);
        const transportCost = this._amount('ccBuyTransport', 'Transportation cost');
        const payMethod = this._paymentMethod('ccBuyPayMethod', ['cash', 'bank', 'credit']);
        const total = this._round(largeCount * largePrice + smallCount * smallPrice + transportCost);
        const paidDrawer = payMethod === 'cash' ? this._amount('ccBuyPaidDrawer', 'Paid from drawer') : 0;
        this._withinTotal(paidDrawer, total, 'Paid from drawer');
        const data = {
          date, estate, largeCount, largePrice, smallCount, smallPrice, transportCost, payMethod,
          notes: document.getElementById('ccBuyNotes').value.trim(), total, paidDrawer,
          createdAt: new Date().toISOString()
        };
        const movements = paidDrawer > 0
          ? [{ type: 'out', amount: paidDrawer, reason: `🥥 Coconut Purchase (${estate})`, source: 'coconut_buy' }]
          : [];
        await this._saveRecord('coconut_purchases', data, movements);
        ['ccBuyEstate', 'ccBuyLargeCount', 'ccBuyLargePrice', 'ccBuySmallCount', 'ccBuySmallPrice', 'ccBuyNotes', 'ccBuyPaidDrawer'].forEach(id => {
          document.getElementById(id).value = '';
        });
        document.getElementById('ccBuyTransport').value = '0';
        this.calcBuyTotal();
        toast('Coconut purchase saved successfully!', 'success');
        await loadAll();
        this.renderBuyList();
      },

      async deletePurchase(id) {
        if (!confirm('Are you sure you want to delete this purchase record?')) return;
        this._validateStockRemoval('coconut_purchases', id);
        await this._deleteRecord('coconut_purchases', id, ['coconut_buy']);
        toast('Purchase record deleted.', 'info');
        await loadAll();
        this.renderBuyList();
      },

      async printPurchaseBill(id) {
        const purchase = S.coconut_purchases.find(record => record.id === id);
        if (!purchase) { toast('Purchase record not found', 'error'); return; }
        await print80mmDoc(this.buildPurchasePrintDoc(purchase));
      },

      async saveHusking() {
        const date = this._date('ccHuskDate');
        const workerId = document.getElementById('ccHuskWorkerSelect').value;
        const worker = this._worker(workerId);
        const largeCount = this._number('ccHuskLargeCount', 'Large count', true);
        const smallCount = this._number('ccHuskSmallCount', 'Small count', true);
        const count = largeCount + smallCount;
        const rate = this._amount('ccHuskRate', 'Husking rate');
        if (count <= 0) throw new Error('Please enter husked count');
        if (rate <= 0) throw new Error('Please enter husking rate');
        this._requireStock({ rawLargeStock: largeCount, rawSmallStock: smallCount }, date);
        const total = this._round(count * rate);
        const paidDrawer = this._amount('ccHuskPaidDrawer', 'Paid from drawer');
        this._withinTotal(paidDrawer, total, 'Paid from drawer');
        const data = {
          date, workerId, worker: worker.name, count, largeCount, smallCount, rate, total, paidDrawer,
          createdAt: new Date().toISOString()
        };
        const movements = paidDrawer > 0
          ? [{ type: 'out', amount: paidDrawer, reason: `⚒️ Coconut Husking (${worker.name})`, source: 'coconut_husk' }]
          : [];
        await this._saveRecord('coconut_husking', data, movements);
        ['ccHuskLargeCount', 'ccHuskSmallCount', 'ccHuskPaidDrawer'].forEach(id => { document.getElementById(id).value = ''; });
        this.calcHuskTotal();
        toast('Husking record saved successfully!', 'success');
        await loadAll();
        this.renderProcessingLists();
      },

      async deleteHusking(id) {
        if (!confirm('Are you sure you want to delete this husking record?')) return;
        this._validateStockRemoval('coconut_husking', id);
        await this._deleteRecord('coconut_husking', id, ['coconut_husk']);
        toast('Husking record deleted.', 'info');
        await loadAll();
        this.renderProcessingLists();
      },

      async saveCopra() {
        const date = this._date('ccCopraDate');
        const nutsUsed = this._number('ccCopraNuts', 'Peeled coconuts used', true);
        const copraKg = this._number('ccCopraKg', 'Copra output');
        const dryingCost = this._amount('ccCopraCost', 'Drying cost');
        const paidDrawer = this._amount('ccCopraPaidDrawer', 'Paid from drawer');
        if (nutsUsed <= 0) throw new Error('Please enter coconuts used');
        if (copraKg <= 0) throw new Error('Please enter measured copra output in kg');
        this._requireStock({ peeledStock: nutsUsed }, date);
        this._withinTotal(paidDrawer, dryingCost, 'Paid from drawer');
        const data = {
          date, nutsUsed, copraKg, dryingCost, paidDrawer,
          notes: document.getElementById('ccCopraNotes').value.trim(),
          createdAt: new Date().toISOString()
        };
        const movements = paidDrawer > 0
          ? [{ type: 'out', amount: paidDrawer, reason: '🥥 Copra Drying Batch', source: 'coconut_copra' }]
          : [];
        await this._saveRecord('coconut_copra', data, movements);
        ['ccCopraNuts', 'ccCopraKg', 'ccCopraNotes'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('ccCopraCost').value = '0';
        document.getElementById('ccCopraPaidDrawer').value = '0';
        this.calcCopraTotal();
        toast('Copra production batch saved!', 'success');
        await loadAll();
        this.renderProcessingLists();
      },

      async recordCopraYield(id) {
        const record = S.coconut_copra.find(batch => batch.id === id);
        if (!record) throw new Error('Copra batch not found');
        const answer = prompt('Enter the measured copra output for this batch in kg.', this._hasCopraYield(record) ? String(record.copraKg) : '');
        if (answer === null) return;
        const copraKg = Number(answer);
        if (!Number.isFinite(copraKg) || copraKg <= 0 || copraKg > Number.MAX_SAFE_INTEGER) {
          throw new Error('Please enter a positive, finite copra output in kg');
        }
        await DB.batch([{ type: 'patch', path: 'coconut_copra/' + id, data: { copraKg } }]);
        toast('Measured copra output saved.', 'success');
        await loadAll();
        this.renderProcessingLists();
      },

      async deleteCopra(id) {
        if (!confirm('Are you sure you want to delete this copra batch?')) return;
        this._validateStockRemoval('coconut_copra', id);
        await this._deleteRecord('coconut_copra', id, ['coconut_copra']);
        toast('Copra batch deleted.', 'info');
        await loadAll();
        this.renderProcessingLists();
      },

      async saveOil() {
        const date = this._date('ccOilDate');
        const copraUsed = this._number('ccOilCopra', 'Copra milled');
        const oilQty = this._number('ccOilQty', 'Oil extracted');
        const poonacQty = this._number('ccOilPoonac', 'Poonac produced');
        const millingCost = this._amount('ccOilCost', 'Milling cost');
        const paidDrawer = this._amount('ccOilPaidDrawer', 'Paid from drawer');
        if (copraUsed <= 0) throw new Error('Please enter copra milled');
        if (oilQty <= 0) throw new Error('Please enter oil quantity obtained');
        this._requireStock({ copraStock: copraUsed }, date);
        this._withinTotal(paidDrawer, millingCost, 'Paid from drawer');
        const data = { date, copraUsed, oilQty, poonacQty, millingCost, paidDrawer, createdAt: new Date().toISOString() };
        const movements = paidDrawer > 0
          ? [{ type: 'out', amount: paidDrawer, reason: '🛢️ Oil Milling Batch', source: 'coconut_oil' }]
          : [];
        await this._saveRecord('coconut_oil', data, movements);
        ['ccOilCopra', 'ccOilQty', 'ccOilPoonac'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('ccOilCost').value = '0';
        document.getElementById('ccOilPaidDrawer').value = '0';
        toast('Oil extraction batch saved!', 'success');
        await loadAll();
        this.renderProcessingLists();
      },

      async deleteOil(id) {
        if (!confirm('Are you sure you want to delete this oil batch?')) return;
        this._validateStockRemoval('coconut_oil', id);
        await this._deleteRecord('coconut_oil', id, ['coconut_oil']);
        toast('Oil batch deleted.', 'info');
        await loadAll();
        this.renderProcessingLists();
      },

      async saveSale() {
        const date = this._date('ccSaleDate');
        const buyer = document.getElementById('ccSaleBuyer').value.trim() || 'Wholesale Buyer';
        const type = document.getElementById('ccSaleType').value;
        if (!['unhusked', 'husked', 'husks', 'shells', 'copra', 'oil', 'poonac'].includes(type)) {
          throw new Error('Please select a valid product type');
        }
        const transportCost = this._amount('ccSaleTransport', 'Transportation cost');
        const transportPaidDrawer = this._amount('ccSaleTransportPaidDrawer', 'Transport paid from drawer');
        this._withinTotal(transportPaidDrawer, transportCost, 'Transport paid from drawer');
        const payMethod = this._paymentMethod('ccSalePayMethod', ['cash', 'card', 'online', 'credit']);
        const recDrawer = payMethod === 'cash' ? this._amount('ccSaleRecDrawer', 'Received to drawer') : 0;
        const data = {
          date, buyer, type, transportCost, transportPaidDrawer, payMethod, recDrawer,
          notes: document.getElementById('ccSaleNotes').value.trim(), createdAt: new Date().toISOString()
        };
        if (type === 'unhusked' || type === 'husked') {
          const largeCount = this._number('ccSaleLargeCount', 'Large count', true);
          const smallCount = this._number('ccSaleSmallCount', 'Small count', true);
          const largePrice = this._amount('ccSaleLargePrice', 'Large price');
          const smallPrice = this._amount('ccSaleSmallPrice', 'Small price');
          this._validateItemized(largeCount, smallCount, largePrice, smallPrice);
          const qty = largeCount + smallCount;
          const total = this._round(largeCount * largePrice + smallCount * smallPrice);
          Object.assign(data, { largeCount, largePrice, smallCount, smallPrice, qty, total, price: total / qty });
          const required = type === 'unhusked'
            ? { rawLargeStock: largeCount, rawSmallStock: smallCount }
            : { peeledStock: qty };
          this._requireStock(required, date);
        } else {
          const qty = this._number('ccSaleCount', 'Sold quantity', type === 'husks');
          const price = this._amount('ccSalePrice', 'Selling price');
          if (qty <= 0) throw new Error('Please enter sold quantity');
          if (price <= 0) throw new Error('Please enter selling price');
          Object.assign(data, { qty, price, total: this._round(qty * price) });
          const stockFields = { husks: 'husksStock', copra: 'copraStock', oil: 'oilStock', poonac: 'poonacStock' };
          if (stockFields[type]) this._requireStock({ [stockFields[type]]: qty }, date);
        }
        this._withinTotal(recDrawer, data.total, 'Received to drawer');
        const movements = [];
        if (recDrawer > 0) movements.push({ type: 'in', amount: recDrawer, reason: `💰 Coconut Sale (${buyer} - ${type})`, source: 'coconut_sale' });
        if (transportPaidDrawer > 0) movements.push({ type: 'out', amount: transportPaidDrawer, reason: `🚚 Sale Transport (${buyer})`, source: 'coconut_sale_transport' });
        await this._saveRecord('coconut_sales', data, movements);
        ['ccSaleBuyer', 'ccSaleCount', 'ccSalePrice', 'ccSaleLargeCount', 'ccSaleLargePrice', 'ccSaleSmallCount', 'ccSaleSmallPrice', 'ccSaleRecDrawer', 'ccSaleNotes'].forEach(id => {
          document.getElementById(id).value = '';
        });
        document.getElementById('ccSaleTransport').value = '0';
        document.getElementById('ccSaleTransportPaidDrawer').value = '0';
        this.calcSaleTotal();
        toast('Coconut sale saved successfully!', 'success');
        await loadAll();
        this.renderSaleList();
      },

      async deleteSale(id) {
        if (!confirm('Are you sure you want to delete this sales record?')) return;
        await this._deleteRecord('coconut_sales', id, ['coconut_sale', 'coconut_sale_transport']);
        toast('Sales record deleted.', 'info');
        await loadAll();
        this.renderSaleList();
      },

      async printSaleBill(id) {
        const sale = S.coconut_sales.find(record => record.id === id);
        if (!sale) { toast('Sales record not found', 'error'); return; }
        await print80mmDoc(this.buildSalePrintDoc(sale));
      },

      async saveWorker() {
        const name = document.getElementById('ccWorkerName').value.trim();
        if (!name) throw new Error('Please enter worker name');
        const data = {
          name, phone: document.getElementById('ccWorkerPhone').value.trim(),
          notes: document.getElementById('ccWorkerNotes').value.trim(), createdAt: new Date().toISOString()
        };
        await this._saveRecord('coconut_workers', data);
        ['ccWorkerName', 'ccWorkerPhone', 'ccWorkerNotes'].forEach(id => { document.getElementById(id).value = ''; });
        toast('Worker registered successfully!', 'success');
        await loadAll();
        this.updateWorkerDropdowns();
        this.renderPayroll();
      },

      async saveWorkerPayment() {
        const date = this._date('ccPayDate');
        const workerId = document.getElementById('ccPayWorkerSelect').value;
        const worker = this._worker(workerId);
        const amount = this._amount('ccPayAmount', 'Amount paid');
        const paidDrawer = this._amount('ccPayPaidDrawer', 'Paid from drawer');
        if (amount <= 0) throw new Error('Please enter amount to pay');
        const outstanding = Math.max(0, Math.min(this._workerOutstanding(workerId, date), this._workerOutstanding(workerId)));
        this._withinTotal(amount, outstanding, 'Wage payment');
        this._withinTotal(paidDrawer, amount, 'Paid from drawer');
        const data = { date, workerId, workerName: worker.name, amount, paidDrawer, createdAt: new Date().toISOString() };
        const movements = paidDrawer > 0
          ? [{ type: 'out', amount: paidDrawer, reason: `👥 Worker Paid (${worker.name})`, source: 'coconut_worker_pay' }]
          : [];
        await this._saveRecord('coconut_worker_payments', data, movements);
        document.getElementById('ccPayAmount').value = '';
        document.getElementById('ccPayPaidDrawer').value = '';
        toast('Wage payment saved!', 'success');
        await loadAll();
        this.renderPayroll();
      },

      async deleteWorkerPayment(id) {
        if (!confirm('Are you sure you want to delete this payment record?')) return;
        await this._deleteRecord('coconut_worker_payments', id, ['coconut_worker_pay']);
        toast('Payment record deleted.', 'info');
        await loadAll();
        this.renderPayroll();
      },

      async saveOperatingExpense() {
        const date = this._date('coconutDate');
        const reason = document.getElementById('ccExpenseDesc').value.trim();
        const amount = this._amount('ccExpenseAmt', 'Expense amount');
        if (!reason) throw new Error('Please enter expense description');
        if (amount <= 0) throw new Error('Please enter a valid amount');
        await this._saveRecord('cash_movements', {
          date: date + 'T12:00:00.000Z', type: 'out', amount, reason,
          source: 'coconut_expense', createdAt: new Date().toISOString()
        });
        document.getElementById('ccExpenseDesc').value = '';
        document.getElementById('ccExpenseAmt').value = '';
        toast('Expense recorded successfully!', 'success');
        await loadAll();
        this.renderSummary();
        this.renderPLReport();
      },

      async deleteExpense(id) {
        if (!confirm('Are you sure you want to delete this expense record?')) return;
        const expense = S.cash_movements.find(record => record.id === id && record.source === 'coconut_expense');
        if (!expense) throw new Error('Expense record not found');
        await this._deleteRecord('cash_movements', id);
        toast('Expense record deleted.', 'info');
        await loadAll();
        this.renderSummary();
        this.renderPLReport();
      },

      openDrawerMoveModal(type) {
        const title = type === 'in' ? '➕ Deposit Cash to Drawer' : '➖ Withdraw Cash from Drawer';
        const label = type === 'in' ? 'Deposit Amount (Rs.)' : 'Withdrawal Amount (Rs.)';
        const actionText = type === 'in' ? 'Deposit Cash' : 'Withdraw Cash';

        document.getElementById('optContent').innerHTML = `
          <div class="modal-head"><div class="modal-title">${title}</div><button class="modal-x" onclick="Modal.close('optModal')">✕</button></div>
          <div class="form-group" style="margin-top:10px;">
            <label>${label}</label>
            <input type="number" id="ccDrawerMoveAmt" placeholder="0.00" min="0.01" step="0.01" autofocus inputmode="decimal">
          </div>
          <div class="form-group">
            <label>Note / Reason</label>
            <input type="text" id="ccDrawerMoveNote" placeholder="e.g. Owner deposit, bank cash withdraw..." inputmode="text">
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" onclick="Modal.close('optModal')">Cancel</button>
            <button class="btn btn-primary" onclick="CoconutMgr.saveDrawerMove('${type}')">${actionText}</button>
          </div>
        `;
        Modal.open('optModal');
        const moveAmtInput = document.getElementById('ccDrawerMoveAmt');
        if (moveAmtInput) moveAmtInput.focus();
        setTimeout(() => document.getElementById('ccDrawerMoveAmt')?.focus(), 200);
      },

      async saveDrawerMove(type) {
        if (type !== 'in' && type !== 'out') throw new Error('Please select a valid cash movement');
        const date = this._date('coconutDate');
        const amount = this._amount('ccDrawerMoveAmt', 'Cash amount');
        const reason = document.getElementById('ccDrawerMoveNote').value.trim();
        if (amount <= 0) throw new Error('Please enter a valid amount');
        if (!reason) throw new Error('Please enter a note/reason');
        await this._saveRecord('cash_movements', {
          date: date + 'T12:00:00.000Z', type, amount, reason,
          source: type === 'in' ? 'coconut_drawer_in' : 'coconut_drawer_out', createdAt: new Date().toISOString()
        });
        Modal.close('optModal');
        toast(type === 'in' ? 'Cash deposited successfully!' : 'Cash withdrawn successfully!', 'success');
        await loadAll();
        this.renderSummary();
      },

      renderSummary() {
        const dateEl = document.getElementById('coconutDate');
        if (!dateEl) return;
        if (!dateEl.value) dateEl.value = this._today();
        const sel = dateEl.value;
        const oldActual = document.getElementById('ccActualCash');
        const oldNote = document.getElementById('ccDayEndNote');
        const draftActual = this._summaryDate === sel && oldActual?.dataset.dirty === 'true' ? oldActual.value : null;
        const draftNote = this._summaryDate === sel && oldNote?.dataset.dirty === 'true' ? oldNote.value : null;

        const stock = this.calcStock();
        const statsEl = document.getElementById('ccSummaryStats');
        if (statsEl) {
          statsEl.innerHTML = `
            <div class="stat-card">
              <div class="stat-lbl">Raw Large Stock</div>
              <div class="stat-val text-orange">${stock.rawLargeStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">Nuts</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Raw Small Stock</div>
              <div class="stat-val text-orange" style="color:#f59e0b;">${stock.rawSmallStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">Nuts</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Peeled Stock</div>
              <div class="stat-val text-green">${stock.peeledStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">Nuts</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Husks Stock</div>
              <div class="stat-val text-cyan">${stock.husksStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">Husks</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Copra Stock</div>
              <div class="stat-val text-orange">${stock.copraStockKnown ? stock.copraStock.toLocaleString('en-GB') : 'Unknown'}</div>
              <div class="stat-sub">${stock.copraStockKnown ? 'kg' : `${stock.copraUnknownBatches} batch output unrecorded. Add measured output in Processing.`}</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Coconut Oil Stock</div>
              <div class="stat-val text-green">${stock.oilStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">Liters</div>
            </div>
            <div class="stat-card">
              <div class="stat-lbl">Poonac Stock</div>
              <div class="stat-val text-cyan">${stock.poonacStock.toLocaleString('en-GB')}</div>
              <div class="stat-sub">kg</div>
            </div>
          `;
        }

        const dayPurchases = S.coconut_purchases.filter(p => p.date === sel);
        const dayHusking = S.coconut_husking.filter(h => h.date === sel);
        const dayCopra = S.coconut_copra.filter(c => c.date === sel);
        const dayOil = S.coconut_oil.filter(o => o.date === sel);
        const daySales = S.coconut_sales.filter(s => s.date === sel);
        const dayWorkerPay = S.coconut_worker_payments.filter(p => p.date === sel);

        const sumHuskEl = document.getElementById('ccSumHusk');
        if (sumHuskEl) {
          sumHuskEl.innerHTML = `
            <div style="font-size:11px;color:var(--t2);margin-bottom:8px;">Daily Activities Summary:</div>
            <div class="total-row"><span>Purchases Count:</span><span class="mono">${dayPurchases.length}</span></div>
            <div class="total-row"><span>Husking Sessions:</span><span class="mono">${dayHusking.length}</span></div>
            <div class="total-row"><span>Copra Batches:</span><span class="mono">${dayCopra.length}</span></div>
            <div class="total-row"><span>Oil Extraction Batches:</span><span class="mono">${dayOil.length}</span></div>
            <div class="total-row"><span>Sales Count:</span><span class="mono">${daySales.length}</span></div>
            <div class="total-row"><span>Wage Payments:</span><span class="mono">${dayWorkerPay.length}</span></div>
          `;
        }

        const {
          drawBuyOut, drawHuskOut, drawCopraOut, drawOilOut, drawSalesIn, drawWorkerPayOut,
          drawSaleTransOut, drawManualIn, drawManualOut, dayExpenses, drawExpensesOut,
          savedFloat, expectedCash
        } = this._drawerTotals(sel);

        const registerEl = document.getElementById('ccCashRegister');
        if (registerEl) {
          registerEl.innerHTML = `
            <div class="total-row">
               <span>Opening Float</span>
               <div style="display:flex;align-items:center;gap:6px;">
                 <input type="number" id="ccOpeningFloatInput" value="${savedFloat}" style="width:100px;text-align:right;padding:3px;font-size:12px;background:var(--bg3);border:1px solid var(--border);" onchange="CoconutMgr.saveOpeningFloat(this.value)">
               </div>
             </div>
             <div class="total-row"><span>+ Sales Cash Income</span><span class="mono text-green">+ Rs. ${drawSalesIn.toFixed(2)}</span></div>
             <div class="total-row"><span>+ Manual Cash Deposits</span><span class="mono text-green">+ Rs. ${drawManualIn.toFixed(2)}</span></div>
             <div style="border-top: 1px dashed var(--border); margin: 4px 0;"></div>
             <div class="total-row"><span>- Purchases (Cash)</span><span class="mono text-red">- Rs. ${drawBuyOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Husking (Cash)</span><span class="mono text-red">- Rs. ${drawHuskOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Copra drying (Cash)</span><span class="mono text-red">- Rs. ${drawCopraOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Oil milled cost (Cash)</span><span class="mono text-red">- Rs. ${drawOilOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Workers payroll (Cash)</span><span class="mono text-red">- Rs. ${drawWorkerPayOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Delivery transport (Cash)</span><span class="mono text-red">- Rs. ${drawSaleTransOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Operating expenses (Cash)</span><span class="mono text-red">- Rs. ${drawExpensesOut.toFixed(2)}</span></div>
             <div class="total-row"><span>- Manual Cash Withdrawals</span><span class="mono text-red">- Rs. ${drawManualOut.toFixed(2)}</span></div>
             <div class="total-row grand" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
               <span>Expected in Drawer</span><span class="mono" style="color:var(--cyan);font-size:17px;">Rs. ${expectedCash.toFixed(2)}</span>
             </div>

             <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
             <div class="form-group" style="margin-bottom:8px;">
               <label style="font-weight:bold;font-size:12px;">Actual Cash Counted</label>
               <input type="number" id="ccActualCash" placeholder="0.00" style="font-size:18px;font-weight:900;color:var(--cyan);background:var(--bg2);border:1px solid var(--cyan);padding:8px;width:100%;border-radius:var(--r8);" oninput="this.dataset.dirty='true';CoconutMgr.calcDiff(${expectedCash})">
             </div>
             <div id="ccDiffRow" style="display:flex;justify-content:space-between;align-items:center;background:var(--glass2);border:1px solid var(--border2);border-radius:var(--r8);padding:8px 12px;margin-top:10px;display:none;">
               <span>Difference:</span>
               <span id="ccDiffVal" class="mono" style="font-size:16px;font-weight:bold;">Rs. 0.00</span>
             </div>

             <div class="form-group" style="margin-top:10px;margin-bottom:8px;">
               <label>Day End Note</label>
               <input type="text" id="ccDayEndNote" oninput="this.dataset.dirty='true'" placeholder="Enter a note..." style="font-size:12px;">
             </div>
             <button class="btn btn-primary w-full" style="margin-top:10px;" onclick="CoconutMgr.saveDayEnd(${expectedCash})">💾 Save Coconut Day End</button>
          `;

          const savedCcDayEnd = S.day_ends.find(d => d.date === sel && d.type === 'coconut');
          if (savedCcDayEnd) {
            const actualInput = document.getElementById('ccActualCash');
            const noteInput = document.getElementById('ccDayEndNote');
            if (actualInput) {
              actualInput.value = savedCcDayEnd.actualCash;
              this.calcDiff(expectedCash);
            }
            if (noteInput) {
              noteInput.value = savedCcDayEnd.note || '';
            }
          }
        }

        // Render operating expenses list
        const expensesEl = document.getElementById('ccExpensesList');
        if (expensesEl) {
          if (!dayExpenses.length) {
            expensesEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:10px;font-size:11px;">No operating expenses recorded today.</div>`;
          } else {
            expensesEl.innerHTML = `<table style="width:100%;font-size:11px;border-collapse:collapse;">
              <tbody>
                ${dayExpenses.map(e => `
                  <tr style="border-bottom:1px solid var(--border2);">
                    <td style="padding:6px 0;"><strong>${esc(e.reason)}</strong></td>
                    <td style="padding:6px 0;text-align:right;color:var(--red);" class="mono">Rs. ${this._value(e.amount).toFixed(2)}</td>
                    <td style="padding:6px 0;text-align:center;width:30px;">
                      <button class="btn btn-danger btn-xs" style="padding:1px 4px;font-size:10px;" onclick="CoconutMgr.deleteExpense('${e.id}')">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`;
          }
        }

        this._summaryDate = sel;
        if (draftActual !== null) {
          const input = document.getElementById('ccActualCash');
          input.value = draftActual;
          input.dataset.dirty = 'true';
          this.calcDiff(expectedCash);
        }
        if (draftNote !== null) {
          const input = document.getElementById('ccDayEndNote');
          input.value = draftNote;
          input.dataset.dirty = 'true';
        }
        this.renderTransportAnalysis();
      },

      renderTransportAnalysis() {
        const tDiv = document.getElementById('ccTransportAnalyzer');
        if (!tDiv) return;

        let purchaseTransport = 0;
        let salesTransport = 0;
        let totalNutsPurchased = 0;
        let totalUnitsSold = 0;

        S.coconut_purchases.forEach(p => {
          purchaseTransport += (parseFloat(p.transportCost) || 0);
          totalNutsPurchased += (parseInt(p.largeCount) || 0) + (parseInt(p.smallCount) || 0);
        });

        S.coconut_sales.forEach(s => {
          salesTransport += (parseFloat(s.transportCost) || 0);
          totalUnitsSold += (parseFloat(s.qty) || 0);
        });

        const totalTransport = purchaseTransport + salesTransport;
        const avgBuyTransportPerNut = totalNutsPurchased > 0 ? purchaseTransport / totalNutsPurchased : 0;
        const avgSaleTransportPerUnit = totalUnitsSold > 0 ? salesTransport / totalUnitsSold : 0;

        let warningHtml = "";
        if (avgBuyTransportPerNut > 5.00) {
          warningHtml = `
            <div style="background:rgba(239, 68, 68, 0.15); border:1px solid var(--red); color:var(--red); padding:10px; border-radius:var(--r8); margin-top:10px; font-size:11px; line-height:1.4;">
              <strong>⚠️ High Transport Overhead:</strong> Buy transport cost is <strong>Rs. ${avgBuyTransportPerNut.toFixed(2)}</strong> per nut. Try to purchase larger loads to decrease unit transport cost.
            </div>
          `;
        } else if (totalTransport > 0) {
          warningHtml = `
            <div style="background:rgba(6, 182, 212, 0.1); border:1px solid var(--cyan); color:var(--cyan); padding:10px; border-radius:var(--r8); margin-top:10px; font-size:11px; line-height:1.4;">
              <strong>💡 Efficiency Tip:</strong> Try consolidating shipments or sharing truck capacity to bring transport cost below Rs. 3.00/nut.
            </div>
          `;
        } else {
          warningHtml = `
            <div style="color:var(--t3); padding:10px; text-align:center; font-size:11px;">No transport costs registered.</div>
          `;
        }

        tDiv.innerHTML = `
          <div class="total-row"><span>Purchase Transport:</span><span class="mono">Rs. ${purchaseTransport.toFixed(2)}</span></div>
          <div class="total-row"><span>Sales Transport:</span><span class="mono">Rs. ${salesTransport.toFixed(2)}</span></div>
          <div class="total-row grand" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">
            <span>Total Transport Cost:</span><span class="mono text-orange" style="font-weight:bold;">Rs. ${totalTransport.toFixed(2)}</span>
          </div>
          <div style="border-top:1px dashed var(--border); margin:8px 0;"></div>
          <div class="total-row" style="font-size:11px; color:var(--t2);"><span>Avg Cost / Nut Bought:</span><span class="mono">Rs. ${avgBuyTransportPerNut.toFixed(2)}</span></div>
          <div class="total-row" style="font-size:11px; color:var(--t2);"><span>Avg Cost / Unit Sold:</span><span class="mono">Rs. ${avgSaleTransportPerUnit.toFixed(2)}</span></div>
          ${warningHtml}
        `;
      },

      renderPLReport() {
        const startEl = document.getElementById('ccPLStartDate');
        const endEl = document.getElementById('ccPLEndDate');
        const resEl = document.getElementById('ccPLReportResult');
        if (!startEl || !endEl || !resEl) return;

        const start = startEl.value;
        const end = endEl.value;

        if (!start || !end) {
          resEl.innerHTML = `<div style="color:var(--t3); font-size:12px;">Please select both start and end dates.</div>`;
          return;
        }

        if (start > end) {
          resEl.innerHTML = '<div class="text-red">Start date must be on or before end date.</div>';
          return;
        }
        const filterByDate = arr => arr.filter(record => {
          const date = String(record.date || '').slice(0, 10);
          return date >= start && date <= end;
        });

        const rangeBuy = filterByDate(S.coconut_purchases);
        const rangeHusk = filterByDate(S.coconut_husking);
        const rangeCopra = filterByDate(S.coconut_copra);
        const rangeOil = filterByDate(S.coconut_oil);
        const rangeSales = filterByDate(S.coconut_sales);

        const rangeExpenses = S.cash_movements.filter(m => {
          const d = m.date ? m.date.split('T')[0] : '';
          return d >= start && d <= end && m.source === 'coconut_expense';
        });

        const buyCost = rangeBuy.reduce((a, p) => a + this._value(p.total), 0);
        const buyTransport = rangeBuy.reduce((a, p) => a + this._value(p.transportCost), 0);
        const huskCost = rangeHusk.reduce((a, h) => a + this._value(h.total), 0);
        const copraDryingCost = rangeCopra.reduce((a, c) => a + this._value(c.dryingCost), 0);
        const oilMillingCost = rangeOil.reduce((a, o) => a + this._value(o.millingCost), 0);
        const totalExpenses = rangeExpenses.reduce((a, m) => a + this._value(m.amount), 0);

        let salesUnhusked = 0;
        let salesHusked = 0;
        let salesHusks = 0;
        let salesShells = 0;
        let salesCopra = 0;
        let salesOil = 0;
        let salesPoonac = 0;
        let salesTransport = 0;

        rangeSales.forEach(s => {
          salesTransport += this._value(s.transportCost);
          const total = this._value(s.total);
          if (s.type === 'unhusked') salesUnhusked += total;
          else if (s.type === 'husked') salesHusked += total;
          else if (s.type === 'husks') salesHusks += total;
          else if (s.type === 'shells') salesShells += total;
          else if (s.type === 'copra') salesCopra += total;
          else if (s.type === 'oil') salesOil += total;
          else if (s.type === 'poonac') salesPoonac += total;
        });

        const totalRevenue = salesUnhusked + salesHusked + salesHusks + salesShells + salesCopra + salesOil + salesPoonac;
        const totalCosts = buyCost + huskCost + copraDryingCost + oilMillingCost + salesTransport + totalExpenses;
        const revenueLessCosts = this._round(totalRevenue - totalCosts);

        resEl.innerHTML = `
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; background:var(--bg3); border:1px solid var(--border); padding:15px; border-radius:var(--r8);">
             <div>
               <h4 style="color:var(--green); border-bottom:1px solid var(--border); padding-bottom:4px; margin-bottom:10px;">💰 Revenue / Sales</h4>
               <div class="total-row"><span>Unhusked Coconuts:</span><span class="mono">Rs. ${salesUnhusked.toFixed(2)}</span></div>
               <div class="total-row"><span>Husked Coconuts:</span><span class="mono">Rs. ${salesHusked.toFixed(2)}</span></div>
               <div class="total-row"><span>Husks:</span><span class="mono">Rs. ${salesHusks.toFixed(2)}</span></div>
               <div class="total-row"><span>Shells:</span><span class="mono">Rs. ${salesShells.toFixed(2)}</span></div>
               <div class="total-row"><span>Copra:</span><span class="mono">Rs. ${salesCopra.toFixed(2)}</span></div>
               <div class="total-row"><span>Coconut Oil:</span><span class="mono">Rs. ${salesOil.toFixed(2)}</span></div>
               <div class="total-row"><span>Poonac:</span><span class="mono">Rs. ${salesPoonac.toFixed(2)}</span></div>
               <div style="border-top:1px dashed var(--border); margin:4px 0;"></div>
               <div class="total-row grand"><span>Total Revenue:</span><span class="mono text-green" style="font-weight:bold;">Rs. ${totalRevenue.toFixed(2)}</span></div>
             </div>
             <div>
               <h4 style="color:var(--red); border-bottom:1px solid var(--border); padding-bottom:4px; margin-bottom:10px;">📉 Costs / Expenses</h4>
               <div class="total-row"><span>Coconut Purchases:</span><span class="mono">Rs. ${buyCost.toFixed(2)}</span></div>
               <div class="total-row" style="font-size:11px; color:var(--t3); padding-left:10px;"><span>└ purchase transport:</span><span class="mono">Rs. ${buyTransport.toFixed(2)}</span></div>
               <div class="total-row"><span>Husking Wages Earned:</span><span class="mono">Rs. ${huskCost.toFixed(2)}</span></div>
               <div class="total-row"><span>Copra Drying Cost:</span><span class="mono">Rs. ${copraDryingCost.toFixed(2)}</span></div>
               <div class="total-row"><span>Oil Extraction Cost:</span><span class="mono">Rs. ${oilMillingCost.toFixed(2)}</span></div>
               <div class="total-row"><span>Sales Delivery Transport:</span><span class="mono">Rs. ${salesTransport.toFixed(2)}</span></div>
               <div class="total-row" style="color:var(--orange);"><span>Operating Expenses:</span><span class="mono">Rs. ${totalExpenses.toFixed(2)}</span></div>
               <div style="border-top:1px dashed var(--border); margin:4px 0;"></div>
               <div class="total-row grand"><span>Total Cost:</span><span class="mono text-red" style="font-weight:bold;">Rs. ${totalCosts.toFixed(2)}</span></div>
             </div>
             <div style="grid-column: span 2; border-top:1px solid var(--border); padding-top:12px; margin-top:5px; display:flex; justify-content:space-between; align-items:center;">
               <strong style="font-size:14px;">Revenue less recorded costs</strong>
               <span class="mono ${revenueLessCosts >= 0 ? 'text-green' : 'text-red'}" style="font-size:18px; font-weight:bold;">
                 Rs. ${revenueLessCosts.toFixed(2)}
               </span>
             </div>
             <p style="grid-column:span 2;margin:0;color:var(--t2);font-size:12px;line-height:1.6;">Includes purchases held in stock. Inventory valuation is required for gross profit. Sales and costs include credit transactions. Cash received and paid are shown in the cash register.</p>
           </div>
        `;
      },

      calcDiff(expected) {
        const actualInput = document.getElementById('ccActualCash');
        const diffRow = document.getElementById('ccDiffRow');
        const diffVal = document.getElementById('ccDiffVal');
        if (!actualInput || !diffRow || !diffVal) return;

        const val = parseFloat(actualInput.value);
        if (!Number.isFinite(val)) {
          diffRow.style.display = 'none';
          return;
        }

        const diff = this._round(val - expected);
        diffRow.style.display = 'flex';

        const cur = S.settings.currency || 'Rs.';
        if (diff === 0) {
          diffVal.textContent = 'Rs. 0.00 (Balanced)';
          diffVal.style.color = 'var(--green)';
        } else if (diff > 0) {
          diffVal.textContent = `+${cur} ${diff.toFixed(2)} (Over)`;
          diffVal.style.color = 'var(--cyan)';
        } else {
          diffVal.textContent = `-${cur} ${Math.abs(diff).toFixed(2)} (Short)`;
          diffVal.style.color = 'var(--red)';
        }
      },

      async saveOpeningFloat(value) {
        const date = this._date('coconutDate');
        const amount = Number(value || 0);
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Opening float must be a nonnegative amount');
        const rounded = this._round(amount);
        await DB.batch([{ type: 'set', path: 'settings/main/coconutOpeningFloats/' + date, data: rounded }]);
        S.settings.coconutOpeningFloats = { ...S.settings.coconutOpeningFloats, [date]: rounded };
        toast('Coconut opening float saved.', 'success');
        await loadAll();
        this.renderSummary();
      },

      async saveDayEnd(expected) {
        const date = this._date('coconutDate');
        const actualInput = document.getElementById('ccActualCash');
        if (!actualInput.value.trim()) throw new Error('Please enter actual cash in drawer');
        const actualCash = this._amount('ccActualCash', 'Actual cash in drawer');
        const expectedCash = this._drawerTotals(date).expectedCash;
        const data = {
          date, type: 'coconut', expectedCash, actualCash, diff: this._round(actualCash - expectedCash),
          note: document.getElementById('ccDayEndNote').value.trim(), updatedAt: new Date().toISOString()
        };
        const existing = S.day_ends.find(record => record.date === date && record.type === 'coconut');
        const id = existing ? existing.id : 'coconut_' + date;
        await DB.batch([{ type: existing ? 'patch' : 'set', path: 'day_ends/' + id, data }]);
        actualInput.dataset.dirty = 'false';
        document.getElementById('ccDayEndNote').dataset.dirty = 'false';
        toast('Coconut day-end report saved successfully!', 'success');
        await loadAll();
      },

      renderBuyList() {
        const sel = document.getElementById('coconutDate')?.value || this._today();
        const listEl = document.getElementById('ccBuyList');
        if (!listEl) return;

        const dayPurchases = S.coconut_purchases.filter(p => p.date === sel);
        if (!dayPurchases.length) {
          listEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:20px;font-size:12px;">No purchases recorded on this date.</div>`;
          return;
        }

        listEl.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--t3);">
              <th style="padding:6px 0;">Estate / Supplier</th>
              <th style="padding:6px 0;text-align:right;">Large</th>
              <th style="padding:6px 0;text-align:right;">Small</th>
              <th style="padding:6px 0;text-align:right;">Transport</th>
              <th style="padding:6px 0;text-align:right;">Total Cost</th>
              <th style="padding:6px 0;text-align:right;">From Drawer</th>
              <th style="padding:6px 0;text-align:center;width:80px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${dayPurchases.map(p => `
              <tr style="border-bottom:1px solid var(--border2);">
                <td style="padding:8px 0;font-weight:600;">${esc(p.estate)} <span style="font-size:9px;color:var(--t3)">(${esc(p.payMethod)})</span></td>
                <td style="padding:8px 0;text-align:right;" class="mono">${p.largeCount} <span style="font-size:9px;color:var(--t3)">(@${p.largePrice})</span></td>
                <td style="padding:8px 0;text-align:right;" class="mono">${p.smallCount} <span style="font-size:9px;color:var(--t3)">(@${p.smallPrice})</span></td>
                <td style="padding:8px 0;text-align:right;color:var(--orange);" class="mono">Rs. ${this._value(p.transportCost).toFixed(2)}</td>
                <td style="padding:8px 0;text-align:right;color:var(--orange);" class="mono">Rs. ${this._value(p.total).toFixed(2)}</td>
                <td style="padding:8px 0;text-align:right;color:var(--red);" class="mono">Rs. ${this._value(p.paidDrawer).toFixed(2)}</td>
                <td style="padding:8px 0;text-align:center;display:flex;gap:4px;justify-content:center;margin-top:6px;">
                  <button class="btn btn-ghost btn-xs" style="padding:2px 5px;" onclick="CoconutMgr.printPurchaseBill('${p.id}')">🖨️ Print</button>
                  <button class="btn btn-danger btn-xs" style="padding:2px 5px;" onclick="CoconutMgr.deletePurchase('${p.id}')">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      },

      renderProcessingLists() {
        const selDate = document.getElementById('coconutDate')?.value || this._today();

        // 1. Husking list
        const huskEl = document.getElementById('ccHuskList');
        if (huskEl) {
          const dayHusk = S.coconut_husking.filter(h => h.date === selDate);
          if (!dayHusk.length) {
            huskEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:10px;font-size:11px;">No husking logs.</div>`;
          } else {
            huskEl.innerHTML = `<table style="width:100%;font-size:11px;border-collapse:collapse;">
              <tbody>
                ${dayHusk.map(h => `
                  <tr style="border-bottom:1px solid var(--border2);">
                    <td style="padding:6px 0;">
                      <strong>${esc(h.worker)}</strong>: ${h.count} nuts
                      <span style="font-size:9px;color:var(--t3)">(${h.largeCount || 0} L, ${h.smallCount || 0} S)</span>
                    </td>
                    <td style="padding:6px 0;text-align:right;" class="mono">Rs. ${this._value(h.total).toFixed(2)}</td>
                    <td style="padding:6px 0;text-align:center;width:30px;">
                      <button class="btn btn-danger btn-xs" style="padding:1px 4px;font-size:10px;" onclick="CoconutMgr.deleteHusking('${h.id}')">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`;
          }
        }

        // 2. Copra list
        const copraEl = document.getElementById('ccCopraList');
        if (copraEl) {
          const dayCopra = S.coconut_copra.filter(c => c.date === selDate);
          if (!dayCopra.length) {
            copraEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:10px;font-size:11px;">No copra logs.</div>`;
          } else {
            copraEl.innerHTML = `<table style="width:100%;font-size:11px;border-collapse:collapse;">
              <tbody>
                ${dayCopra.map(c => `
                  <tr style="border-bottom:1px solid var(--border2);">
                    <td style="padding:6px 0;">Used: ${this._value(c.nutsUsed)} peeled nuts · Output ${this._hasCopraYield(c) ? this._value(c.copraKg) + ' kg' : 'unrecorded'} ${c.notes ? `<span style="font-size:9px;color:var(--t3)">(${esc(c.notes)})</span>` : ''}
                      ${!this._hasCopraYield(c) ? `<button class="btn btn-ghost btn-xs" onclick="CoconutMgr.recordCopraYield('${c.id}')">Add measured output</button>` : ''}</td>
                    <td style="padding:6px 0;text-align:right;" class="mono">Rs. ${this._value(c.dryingCost).toFixed(2)}</td>
                    <td style="padding:6px 0;text-align:center;width:30px;">
                      <button class="btn btn-danger btn-xs" style="padding:1px 4px;font-size:10px;" onclick="CoconutMgr.deleteCopra('${c.id}')">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`;
          }
        }

        // 3. Oil list
        const oilEl = document.getElementById('ccOilList');
        if (oilEl) {
          const dayOil = S.coconut_oil.filter(o => o.date === selDate);
          if (!dayOil.length) {
            oilEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:10px;font-size:11px;">No oil milling logs.</div>`;
          } else {
            oilEl.innerHTML = `<table style="width:100%;font-size:11px;border-collapse:collapse;">
              <tbody>
                ${dayOil.map(o => `
                  <tr style="border-bottom:1px solid var(--border2);">
                    <td style="padding:6px 0;">Milled: ${o.copraUsed}kg, Yielded: ${o.oilQty}L oil, ${o.poonacQty}kg poonac</td>
                    <td style="padding:6px 0;text-align:right;" class="mono">Rs. ${this._value(o.millingCost).toFixed(2)}</td>
                    <td style="padding:6px 0;text-align:center;width:30px;">
                      <button class="btn btn-danger btn-xs" style="padding:1px 4px;font-size:10px;" onclick="CoconutMgr.deleteOil('${o.id}')">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`;
          }
        }
      },

      renderSaleList() {
        const sel = document.getElementById('coconutDate')?.value || this._today();
        const listEl = document.getElementById('ccSaleList');
        if (!listEl) return;

        const daySales = S.coconut_sales.filter(s => s.date === sel);
        if (!daySales.length) {
          listEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:20px;font-size:12px;">No sales recorded on this date.</div>`;
          return;
        }

        const cur = S.settings.currency || 'Rs.';
        listEl.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--t3);">
              <th style="padding:6px 0;">Buyer</th>
              <th style="padding:6px 0;">Type</th>
              <th style="padding:6px 0;text-align:right;">Details</th>
              <th style="padding:6px 0;text-align:right;">Total</th>
              <th style="padding:6px 0;text-align:right;">To Drawer</th>
              <th style="padding:6px 0;text-align:center;width:80px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${daySales.map(s => {
              let qtyDetails = '';
              if (s.type === 'unhusked' || s.type === 'husked') {
                qtyDetails = this._value(s.largeCount) || this._value(s.smallCount)
                  ? `${this._value(s.largeCount)} L (@${this._value(s.largePrice)}) / ${this._value(s.smallCount)} S (@${this._value(s.smallPrice)})`
                  : `${this._value(s.qty)} nuts (@${this._value(s.price)})`;
              } else {
                qtyDetails = `${this._value(s.qty)} (@${this._value(s.price)})`;
              }
              return `
              <tr style="border-bottom:1px solid var(--border2);">
                <td style="padding:8px 0;font-weight:600;">${esc(s.buyer)}</td>
                <td style="padding:8px 0;"><span class="badge badge-cyan" style="text-transform:capitalize;">${esc(s.type)}</span></td>
                <td style="padding:8px 0;text-align:right;" class="mono">${qtyDetails}</td>
                <td style="padding:8px 0;text-align:right;color:var(--green);" class="mono">Rs. ${this._value(s.total).toFixed(2)}</td>
                <td style="padding:8px 0;text-align:right;color:var(--green);" class="mono">Rs. ${this._value(s.recDrawer).toFixed(2)} <span style="font-size:8px;color:var(--t3)">(${esc(s.payMethod)})</span></td>
                <td style="padding:8px 0;text-align:center;display:flex;gap:4px;justify-content:center;margin-top:6px;">
                  <button class="btn btn-ghost btn-xs" style="padding:2px 5px;" onclick="CoconutMgr.printSaleBill('${s.id}')">🖨️ Print</button>
                  <button class="btn btn-danger btn-xs" style="padding:2px 5px;" onclick="CoconutMgr.deleteSale('${s.id}')">🗑️</button>
                </td>
              </tr>
            `}).join('')}
          </tbody>
        </table>`;
      },

      renderPayroll() {
        const listEl = document.getElementById('ccWorkersLedger');
        const paysEl = document.getElementById('ccPaymentsList');
        if (!listEl || !paysEl) return;

        const workerLedger = S.coconut_workers.map(w => {
          const earnings = S.coconut_husking.filter(h => h.workerId === w.id).reduce((a, h) => a + this._value(h.total), 0);
          const payments = S.coconut_worker_payments.filter(p => p.workerId === w.id).reduce((a, p) => a + this._value(p.amount), 0);
          const immediatePaid = S.coconut_husking.filter(h => h.workerId === w.id).reduce((a, h) => a + this._value(h.paidDrawer), 0);

          const totalPaid = payments + immediatePaid;
          const balance = earnings - totalPaid;
          return { ...w, earnings, paid: totalPaid, balance };
        });

        if (!workerLedger.length) {
          listEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:20px;font-size:12px;">No workers registered yet.</div>`;
        } else {
          listEl.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--t3);">
                <th style="padding:6px 0;">Worker Name</th>
                <th style="padding:6px 0;">Phone</th>
                <th style="padding:6px 0;text-align:right;">Total Earned</th>
                <th style="padding:6px 0;text-align:right;">Total Paid</th>
                <th style="padding:6px 0;text-align:right;">Outstanding Due</th>
              </tr>
            </thead>
            <tbody>
              ${workerLedger.map(w => `
                <tr style="border-bottom:1px solid var(--border2);">
                  <td style="padding:8px 0;font-weight:600;">${esc(w.name)}</td>
                  <td style="padding:8px 0;">${esc(w.phone || '--')}</td>
                  <td style="padding:8px 0;text-align:right;color:var(--cyan);" class="mono">Rs. ${w.earnings.toFixed(2)}</td>
                  <td style="padding:8px 0;text-align:right;color:var(--green);" class="mono">Rs. ${w.paid.toFixed(2)}</td>
                  <td style="padding:8px 0;text-align:right;color:${w.balance > 0 ? 'var(--orange)' : 'var(--t3)'};font-weight:bold;" class="mono">Rs. ${w.balance.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`;
        }

        const selDate = document.getElementById('coconutDate')?.value || this._today();
        const dayPayments = S.coconut_worker_payments.filter(p => p.date === selDate);

        if (!dayPayments.length) {
          paysEl.innerHTML = `<div style="color:var(--t3);text-align:center;padding:15px;font-size:12px;">No wage payments recorded today.</div>`;
        } else {
          paysEl.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--t3);">
                <th style="padding:6px 0;">Worker Name</th>
                <th style="padding:6px 0;text-align:right;">Wages Paid</th>
                <th style="padding:6px 0;text-align:right;">From Drawer</th>
                <th style="padding:6px 0;text-align:center;width:40px;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${dayPayments.map(p => `
                <tr style="border-bottom:1px solid var(--border2);">
                  <td style="padding:8px 0;font-weight:600;">${esc(p.workerName)}</td>
                  <td style="padding:8px 0;text-align:right;color:var(--green);" class="mono">Rs. ${this._value(p.amount).toFixed(2)}</td>
                  <td style="padding:8px 0;text-align:right;color:var(--red);" class="mono">Rs. ${this._value(p.paidDrawer).toFixed(2)}</td>
                  <td style="padding:8px 0;text-align:center;">
                    <button class="btn btn-danger btn-xs" style="padding:2px 5px;" onclick="CoconutMgr.deleteWorkerPayment('${p.id}')">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`;
        }
      }
    };

// Serialize Coconut mutations so repeated clicks cannot save duplicate records.
for (const methodName of [
  'savePurchase', 'deletePurchase', 'saveHusking', 'deleteHusking', 'saveCopra', 'recordCopraYield',
  'deleteCopra', 'saveOil', 'deleteOil', 'saveSale', 'deleteSale', 'saveWorker',
  'saveWorkerPayment', 'deleteWorkerPayment', 'saveOperatingExpense', 'deleteExpense',
  'saveDrawerMove', 'saveOpeningFloat', 'saveDayEnd'
]) {
  const action = CoconutMgr[methodName];
  CoconutMgr[methodName] = async function (...args) {
    if (this._mutationPending) return false;
    this._mutationPending = true;
    try {
      return await action.apply(this, args);
    } catch (error) {
      console.error('Coconut operation failed', error);
      toast(error.message || 'The record could not be saved. Please try again.', 'error');
      return false;
    } finally {
      this._mutationPending = false;
    }
  };
}
