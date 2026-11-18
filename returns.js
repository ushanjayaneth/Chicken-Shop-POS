/* Credit notes remain linked to their return and are redeemed with the replacement sale. */
const ExchangeCredits = {
  plan(cart, saleTotal, strict = false) {
    const credits = [];
    const seen = new Set();
    let due = saleTotal;
    for (const line of cart.filter(line => line.isExchangeCredit)) {
      if (seen.has(line.creditId)) continue;
      seen.add(line.creditId);
      const voucher = S.sales.find(sale => sale.id === line.creditId);
      const balance = SaleAccounting.money(voucher?.exchangeCreditRemaining);
      if (!voucher || balance <= 0) {
        if (strict) throw new Error('This exchange credit is unavailable. Remove it and review the return.');
        continue;
      }
      const amount = Math.min(balance, Math.max(0, due));
      if (amount > 0) credits.push({id:voucher.id, voucher, amount, line});
      due = SaleAccounting.money(due - amount);
    }
    return credits;
  },
  operations(credits, saleId) {
    return credits.map(credit => ({type:'patch',path:'sales/'+credit.id,
      expected:{exchangeCreditRemaining:credit.voucher.exchangeCreditRemaining},
      data:{exchangeCreditRemaining:SaleAccounting.money(credit.voucher.exchangeCreditRemaining-credit.amount),
        creditRedemptions:[...(credit.voucher.creditRedemptions||[]),{saleId,amount:credit.amount,date:new Date().toISOString()}]}}));
  },
  add(id) {
    const voucher=S.sales.find(sale=>sale.id===id);
    const balance=SaleAccounting.money(voucher?.exchangeCreditRemaining);
    if (!voucher || balance<=0) {toast('This exchange credit has already been used.','error');return;}
    if (S.cart.some(line=>line.saleMode==='loan')) {toast('Exchange credit is saved. Complete the current loan bill before using it on a paid sale.','info');return;}
    if (!S.cart.some(line=>line.isExchangeCredit&&line.creditId===id)) S.cart.push({isExchangeCredit:true,creditId:id,itemId:'EXCHANGE_'+id,name:'Exchange credit',qty:1,unit:'credit',price:0,unitPrice:0,discount:0,saleMode:'retail'});
    if (!S.cart.some(line=>!line.isExchangeCredit)) POS.setMode('retail');
    Cart.render();Nav.go('pos');
    toast('Exchange credit added. Choose the replacement products.','success');
  },
  render(line, index) {
    const totals=SaleAccounting.totals(S.cart);
    const used=totals.credits.find(credit=>credit.id===line.creditId)?.amount||0;
    const voucher=S.sales.find(sale=>sale.id===line.creditId);
    return `<div class="cart-item exchange-credit-line"><div><strong>Exchange credit</strong><div class="text-muted">Available ${esc(S.settings.currency)} ${Number(voucher?.exchangeCreditRemaining||0).toFixed(2)}</div></div><strong>−${esc(S.settings.currency)} ${used.toFixed(2)}</strong><button class="btn btn-ghost btn-icon" aria-label="Remove exchange credit" onclick="Cart.remove(${index})">×</button></div>`;
  }
};

const ReturnMgr = {
  _lastSearchedBill:null,
  switchTab() {if(this._lastSearchedBill)this.searchBill();},
  async load() {if(document.getElementById('returnsTab')?.classList.contains('active')&&this._lastSearchedBill)await this.searchBill();},
  async searchBill() {
    const bill=document.getElementById('retBillSearch').value.trim();
    if(!bill){toast('Enter the bill ID from the receipt.','error');return;}
    const records=DB.obj2arr(await DB.get('sales'));
    const sale=records.find(record=>(record.id===bill||record.billId===bill)&&record.status!=='return');
    const result=document.getElementById('retBillResult');
    if(!sale){result.innerHTML='<div class="empty-state">No matching sale was found.</div>';this._lastSearchedBill=null;return;}
    this._lastSearchedBill=sale;
    const position=S.sales.findIndex(record=>record.id===sale.id);
    if(position<0)S.sales.push(sale);else S.sales[position]=sale;
    const returned=SaleDetail._returnedQuantities(sale);
    const net=SaleAccounting.netAmounts(sale);
    const credits=records.filter(record=>record.returnOf===sale.id&&Number(record.exchangeCreditRemaining)>0);
    result.innerHTML=`<div class="admin-section"><h3>${esc(sale.billId||sale.id)}</h3><p class="text-muted">${esc(new Date(sale.date).toLocaleString())}</p>
      ${(sale.items||[]).map((line,index)=>{
        const remaining=Math.max(0,Number(line.qty)-returned[index]);
        return `<div class="return-search-row"><div><strong>${esc(line.name)}</strong><small>${remaining} ${esc(line.unit||'')} available for return · ${esc(S.settings.currency)} ${Number(net[index]||0).toFixed(2)}</small></div>${remaining>0?`<button class="btn btn-ghost" onclick="ReturnMgr.processReturn('${sale.id}',${index})">Return or exchange</button>`:'<span class="badge">Returned</span>'}</div>`;
      }).join('')}
      ${credits.map(credit=>`<div class="return-search-row"><strong>Exchange credit ${esc(S.settings.currency)} ${Number(credit.exchangeCreditRemaining).toFixed(2)}</strong><button class="btn btn-primary" onclick="ExchangeCredits.add('${credit.id}')">Use credit</button></div>`).join('')}
    </div>`;
  },
  processReturn(id,index) {
    SaleDetail.openReturn(id);
    document.querySelectorAll('.ret-chk').forEach(checkbox=>{checkbox.checked=Number(checkbox.dataset.idx)===index;});
  },
  async executeReturn(id,index,type) {
    this.processReturn(id,index);
    return SaleDetail.processReturn(id,type==='exchange'?'exchange':'refund');
  }
};