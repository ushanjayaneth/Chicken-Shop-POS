import {validateCoconutLedger} from './coconut-ledger.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const money = value => Math.round(Number(value || 0) * 100) / 100;
const list = value => Object.values(value || {}).filter(Boolean);
const blocked = new Set(['__proto__','constructor','prototype']);
export class CommitConflict extends Error {constructor(message){super(message);this.status=409;this.code='SYNC_CONFLICT';}}
export function pathParts(path) {
  if(typeof path!=='string')throw new Error('Invalid database path');
  const parts=path.split('/');
  if(parts.some(part=>!part||blocked.has(part)||/[.#$\[\]]/.test(part)))throw new Error('Invalid database path');
  return parts;
}
export function readPath(root,path){return pathParts(path).reduce((value,key)=>value?.[key],root)??null;}
export function writePath(root,path,value){
  const parts=pathParts(path);let node=root;
  for(const key of parts.slice(0,-1)){if(!node[key]||typeof node[key]!=='object')node[key]={};node=node[key];}
  if(value===null)delete node[parts.at(-1)];else node[parts.at(-1)]=clone(value);
}
function normalize(field,value){
  if(['stockBatches','paymentHistory','returnItems','creditRedemptions'].includes(field))return list(value);
  if(['paidAmount','refundTotal','exchangeCreditRemaining'].includes(field))return Number(value||0);
  return value??null;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function changeBatchStock(remote, before, after, priorCost, currentCost) {
  const current = clone(list(remote));
  const previous = list(before);
  const next = list(after);
  const batchKey = (batch, index) => batch.batchId ? String(batch.batchId) : 'legacy_' + index;
  const byKey = batches => new Map(batches.map((batch, index) => [batchKey(batch, index), batch]));
  const originalBatches = byKey(previous);
  const changedBatches = byKey(next);
  const round = quantity => Math.round(quantity * 1e6) / 1e6;

  for (const [key, batch] of changedBatches) {
    if (!originalBatches.has(key)) {
      if (byKey(current).has(key)) throw new CommitConflict('This stock batch already exists.');
      current.push(clone(batch));
    }
  }

  for (const [key, oldBatch] of originalBatches) {
    const changedBatch = changedBatches.get(key);
    const delta = round(Number(changedBatch?.quantity || 0) - Number(oldBatch.quantity || 0));
    if (!Number.isFinite(delta)) throw new Error('Invalid stock quantity');
    const removedCodes = list(oldBatch.barcodes).filter(code => !list(changedBatch?.barcodes).includes(code));
    if (delta === 0 && !removedCodes.length) continue;
    if (delta >= 0 || !changedBatch) throw new CommitConflict('Stock changed on another device. Review this adjustment.');

    const preferred = byKey(current).get(key);
    if (removedCodes.some(code => !list(preferred?.barcodes).includes(code))) {
      throw new CommitConflict('A barcode in this bill was already sold on another device.');
    }

    const expectedCost = Number(oldBatch.costPrice ?? priorCost ?? 0);
    const otherBatches = current.filter(batch => batch !== preferred);
    const candidates = removedCodes.length ? [preferred] : [preferred, ...otherBatches];
    let needed = -delta;
    for (const batch of candidates) {
      if (!batch || Number(batch.costPrice ?? currentCost ?? 0) !== expectedCost) continue;
      const used = Math.min(needed, Math.max(0, Number(batch.quantity) || 0));
      batch.quantity = round(Number(batch.quantity || 0) - used);
      needed = round(needed - used);
      if (needed <= 0) break;
    }
    if (needed > 0) throw new CommitConflict('Stock or purchase cost changed. This transaction needs review.');
    if (removedCodes.length) preferred.barcodes = list(preferred.barcodes).filter(code => !removedCodes.includes(code));
  }
  return current;
}
function scheduleForPaid(loan,paid,proposed,before,date){
  const current=list(loan.installments).map(row=>({...row,paidAmount:Math.max(0,Number(row.paidAmount??(row.paid?row.amount:0)))}));
  if(!current.length)return current;
  const desired=list(proposed);const old=list(before);
  let remaining=money(paid-Math.max(0,Number(loan.totalAmount||loan.total||0)-current.reduce((sum,row)=>sum+Number(row.amount||0),0)));
  const order=current.map((_,index)=>index).sort((a,b)=>(Number(desired[b]?.paidAmount||0)-Number(old[b]?.paidAmount||0))-(Number(desired[a]?.paidAmount||0)-Number(old[a]?.paidAmount||0)));
  const allocations=current.map(row=>Math.min(Number(row.amount),Number(row.paidAmount)));
  remaining=money(remaining-allocations.reduce((sum,value)=>sum+value,0));
  for(const index of order){const extra=Math.min(Math.max(0,remaining),Math.max(0,Number(current[index].amount)-allocations[index]));allocations[index]=money(allocations[index]+extra);remaining=money(remaining-extra);}
  return current.map((row,index)=>({...row,paidAmount:allocations[index],paid:allocations[index]>=Number(row.amount),paidDate:allocations[index]>=Number(row.amount)?row.paidDate||date:null}));
}
export function applyCloudCommit(snapshot,command){
  if(!command||typeof command.id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(command.id)||!command.updates||typeof command.updates!=='object'||Array.isArray(command.updates))throw new Error('Invalid synchronization command');
  const root=clone(snapshot||{});
  if(root._pos_commits?.[command.id])return {snapshot:root,replayed:true};
  const updates=clone(command.updates);
  for(const path of Object.keys(updates))pathParts(path);
  for(const guard of command.guards||[]){
    const existing = readPath(root, guard.path);
    if (!existing && guard.path === 'settings/main') continue;
    const current = existing || {};
    const before=guard.before||{};
    const fields=guard.expected||{};
    const proposed=clone(current);
    for(const [path,value]of Object.entries(updates)){
      if(path===guard.path){Object.keys(proposed).forEach(key=>delete proposed[key]);Object.assign(proposed,value||{});}
      else if(path.startsWith(guard.path+'/'))writePath(proposed,path.slice(guard.path.length+1),value);
    }
    const changed=Object.keys(fields).some(field=>!sameValue(normalize(field,current[field]),normalize(field,fields[field])));
    if(!changed)continue;
    if(guard.path.startsWith('items/')&&Object.hasOwn(fields,'stockBatches')){
      if (Object.hasOwn(updates, guard.path + '/stockAdjustments') || !readPath(root, guard.path)) {
        throw new CommitConflict('Stock changed on another device. Review the pending count or sale.');
      }
      updates[guard.path + '/stockBatches'] = changeBatchStock(current.stockBatches, fields.stockBatches, proposed.stockBatches, before.costPrice, current.costPrice);
      continue;
    }
    if(guard.path.startsWith('loans/')&&Object.hasOwn(fields,'paidAmount')&&Object.hasOwn(fields,'paymentHistory')){
      const increment=money(Number(proposed.paidAmount||0)-Number(fields.paidAmount||0));
      const paid=money(Number(current.paidAmount||0)+increment);
      const total=Number(current.totalAmount||current.total||0);
      if(increment<=0||paid>total+.000001)throw new CommitConflict('The customer balance changed. Review the pending collection.');
      const added=list(proposed.paymentHistory).slice(list(fields.paymentHistory).length);
      updates[guard.path+'/paidAmount']=paid;
      updates[guard.path+'/paymentHistory']=[...list(current.paymentHistory),...added];
      updates[guard.path+'/status']=paid>=total?'cleared':'active';
      updates[guard.path+'/installments']=scheduleForPaid(current,paid,proposed.installments,before.installments,added.at(-1)?.date?.slice(0,10));
      continue;
    }
    if(guard.path.startsWith('sales/')&&Object.hasOwn(fields,'exchangeCreditRemaining')){
      const delta=money(Number(proposed.exchangeCreditRemaining)-Number(fields.exchangeCreditRemaining));
      const remaining=money(Number(current.exchangeCreditRemaining||0)+delta);
      if(delta>0||remaining<0)throw new CommitConflict('Exchange credit changed on another device. Review this bill.');
      updates[guard.path+'/exchangeCreditRemaining']=remaining;
      updates[guard.path+'/creditRedemptions']=[...list(current.creditRedemptions),...list(proposed.creditRedemptions).slice(list(before.creditRedemptions).length)];
      continue;
    }
    if(guard.path.startsWith('sales/')&&Object.hasOwn(fields,'returnItems')){
      const added=list(proposed.returnItems).slice(list(fields.returnItems).length);
      const all=[...list(current.returnItems),...added];
      const quantities=(current.items||[]).map(()=>0);
      for(const item of all){const index=Number(item.sourceIndex);if(!Number.isInteger(index)||!current.items?.[index])throw new CommitConflict('Return details changed. Review the original bill.');quantities[index]+=Number(item.returnQty||0);}
      if(quantities.some((quantity,index)=>quantity>Number(current.items[index].qty)+1e-7))throw new CommitConflict('An item has already been returned on another device.');
      const refunded=money(Number(current.refundTotal||0)+Number(proposed.refundTotal||0)-Number(fields.refundTotal||0));
      if(refunded>Number(current.total||0)+.000001)throw new CommitConflict('The refundable balance changed. Review this return.');
      updates[guard.path+'/returnItems']=all;updates[guard.path+'/refundTotal']=refunded;
      updates[guard.path+'/status']=quantities.every((quantity,index)=>quantity>=Number(current.items[index].qty)-1e-7)?'returned':'partial_return';
      continue;
    }
    throw new CommitConflict('A record changed on another device. Review the pending transaction.');
  }
  for(const [path,value]of Object.entries(updates))writePath(root,path,value);
  validateCoconutLedger(snapshot,root,updates);
  root._pos_commits??={};root._pos_commits[command.id]={at:Date.now()};
  return {snapshot:root,replayed:false};
}
export async function commitToFirebase(baseURL,command,request=fetch){
  for(let attempt=0;attempt<5;attempt++){
    const read=await request(baseURL+'/.json',{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(12000)});
    if(!read.ok){const error=new Error('The cloud database could not be read.');error.status=read.status;throw error;}
    const snapshot=await read.json();
    const planned=applyCloudCommit(snapshot,command);
    if(planned.replayed)return {ok:true,id:command.id,replayed:true};
    const etag=read.headers.get('etag');
    if(!etag)throw new Error('The cloud database did not return a transaction version.');
    const write=await request(baseURL+'/.json',{method:'PUT',headers:{'Content-Type':'application/json','if-match':etag},body:JSON.stringify(planned.snapshot),signal:AbortSignal.timeout(12000)});
    if(write.status===412)continue;
    if(!write.ok){const error=new Error('The cloud database could not save this transaction.');error.status=write.status;throw error;}
    await write.json();
    return {ok:true,id:command.id,replayed:false};
  }
  throw new CommitConflict('The cloud database is busy. This device will retry synchronization.');
}
