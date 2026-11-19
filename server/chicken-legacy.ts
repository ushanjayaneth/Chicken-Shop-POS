import type {CloudChange} from '../shared/cloud-monitor.js';
import type {Category, CreditEntry, Customer, InventoryItem, MenuItem} from '../shared/types.js';
import {firebaseValue} from './firebase-rest.js';

type Row = Record<string, unknown>;
const pairs = (value: unknown): [string, Row][] => value && typeof value === 'object'
  ? Object.entries(value).filter(([id, row]) => /^[A-Za-z0-9_-]{1,118}$/.test(id) && row && typeof row === 'object')
  : [];
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const cents = (value: unknown) => Math.round(100 * number(value));
const timestamp = (value: unknown, fallback: string) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};
function legacyEnabled(env: NodeJS.ProcessEnv) {
  return env.CLOUD_IMPORT_CHICKEN_LEGACY === 'true' && env.CLOUD_TENANT_ID === 'chicken-shop';
}
async function readCollections(env: NodeJS.ProcessEnv, keys: string[]) {
  return Object.fromEntries(await Promise.all(keys.map(async key => [key, await firebaseValue(env,key)] as const)));
}

export async function chickenOpeningRecords(env: NodeJS.ProcessEnv, now: string): Promise<CloudChange[]> {
  if (!legacyEnabled(env)) return [];
  const source = await readCollections(env, ['categories','items','loan_customers','loans']);
  const changes: CloudChange[] = [];
  const add = (kind:CloudChange['kind'], branchId:string|null, value:{id:string}) =>
    changes.push({kind, id:value.id, branchId, value:value as unknown as Record<string,unknown>});
  const categoryIds = new Set<string>();
  for (const [key, row] of pairs(source.categories)) {
    const id = 'legacy-' + key, name = text(row.name).trim();
    if (!name) continue;
    categoryIds.add(id);
    const category: Category = {id, name, nameSi:name, icon:'package'};
    add('category', null, category);
  }
  for (const [key, row] of pairs(source.items)) {
    const id = 'legacy-' + key, name = text(row.name).trim();
    if (!name) continue;
    const unit = text(row.unit, 'pcs');
    const batches = pairs(row.stockBatches).map(([, batch]) => batch);
    const quantity = batches.length ? batches.reduce((sum,batch) => sum + number(batch.quantity), 0) : number(row.stock);
    const value = batches.reduce((sum,batch) => sum + number(batch.quantity) * cents(batch.costPrice ?? row.costPrice), 0);
    const cost = quantity > 0 && batches.length ? Math.round(value / quantity) : cents(row.costPrice);
    const category = 'legacy-' + text(row.categoryId);
    const image = text(row.image);
    const item: MenuItem = {id, name, nameSi:name, description:'', categoryId:categoryIds.has(category) ? category : 'general',
      price:cents(row.price), cost, ...(number(row.wholesalePrice)>0 ? {wholesalePrice:cents(row.wholesalePrice)} : {}),
      image:/^https:\/\//i.test(image) || /^data:image\/(?:jpeg|png|webp);base64,/i.test(image) ? image : '',
      ...(typeof row.barcode==='string' && row.barcode ? {barcode:row.barcode} : {}),
      available:true, stockMode:'prepared', saleUnit:unit, reorderLevel:number(row.lowStockThreshold ?? 5), preparationMinutes:0};
    const inventory: InventoryItem = {id:'stock-' + id, branchId:'b1', name, nameSi:name, category:'resale',
      unit, quantity:Math.round(quantity*1e6)/1e6, minimum:item.reorderLevel ?? 5,
      unitCost:cost, supplierId:null, menuItemId:id, updatedAt:timestamp(row.updatedAt, now)};
    add('menu', null, item);
    add('inventory', 'b1', inventory);
  }
  const loans = pairs(source.loans);
  for (const [key, row] of pairs(source.loan_customers)) {
    const id = 'legacy-' + key, name = text(row.name).trim();
    if (!name) continue;
    let balance = 0;
    for (const [loanId, loan] of loans) {
      if (loan.customerId !== key || ['deleted','void','cancelled'].includes(text(loan.status))) continue;
      const amount = Math.max(0,cents(loan.totalAmount ?? loan.total) - cents(loan.paidAmount));
      if (!amount) continue;
      balance += amount;
      const entry: CreditEntry = {id:'legacy-' + loanId, branchId:'b1', customerId:id, type:'sale', amount, method:'credit',
        orderId:null, reference:loanId, note:'Opening loan balance · ' + text(loan.description, text(loan.items,'Legacy account')),
        createdAt:timestamp(loan.createdAt, now), createdBy:'cloud-owner'};
      add('credit', 'b1', entry);
    }
    const customer: Customer = {id,name,phone:text(row.phone),email:'',visits:0,spent:0,balance,points:0,createdAt:timestamp(row.createdAt,now)};
    add('customer', null, customer);
  }
  return changes;
}

export async function chickenShopArchive(env: NodeJS.ProcessEnv) {
  if (!legacyEnabled(env)) return null;
  const records = await readCollections(env, ['categories','items','sales','loan_customers','loans','cash_movements','day_ends']);
  records.cash_movements = Object.fromEntries(pairs(records.cash_movements).filter(([, row]) => !text(row.source).startsWith('coconut_')));
  records.day_ends = Object.fromEntries(pairs(records.day_ends).filter(([, row]) => row.type !== 'coconut'));
  return {format:'chicken-shop-legacy-archive-v1',exportedAt:new Date().toISOString(),records};
}
