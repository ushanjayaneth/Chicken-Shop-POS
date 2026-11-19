import {chickenBranch} from '../../../shared/chicken-shop.js';
import type {Branch, Category, InventoryItem, MenuItem, Settings, Shift, StaffMember, User} from '../../../shared/types.js';
import {localDb, LocalStore, type LocalDatabase} from './db.js';
import {createLocalCredential, loginLocal, prepareLocalSession, publicLocalUser, rememberLocalSession} from './auth.js';
import {localStorageError, now, requireLocal, uid, type LocalWorkspaceInfo} from './types.js';

export interface InitializeLocalWorkspaceInput {businessName: string; ownerName: string; pin: string; demo?: boolean}
export const localReceiptDefaults = {receiptPaperWidthMm: 80, receiptContentWidthMm: 72, receiptMarginMm: 2, receiptOffsetMm: 0, receiptFontSize: 10};
export async function getLocalWorkspaceInfo(db: LocalDatabase = localDb): Promise<LocalWorkspaceInfo | null> {
  return (await db.metadata.get('workspace'))?.value as LocalWorkspaceInfo | undefined ?? null;
}

const categories: Category[] = [
  {id:'essentials',name:'Essentials',nameSi:'Essentials',icon:'package'},
  {id:'beverages',name:'Beverages',nameSi:'Beverages',icon:'cup'},
  {id:'snacks',name:'Snacks',nameSi:'Snacks',icon:'croissant'},
  {id:'household',name:'Household',nameSi:'Household',icon:'package'},
  {id:'personal-care',name:'Personal care',nameSi:'Personal care',icon:'leaf'},
  {id:'fresh-produce',name:'Fresh produce',nameSi:'Fresh produce',icon:'leaf'},
];
// Prices and costs use minor currency units. Weighted products are priced per kg.
const sampleProducts = [
  ['Samba rice','Loose grain - price per kg','essentials',26000,22000,'kg','rice',86],
  ['White sugar','Loose sugar - price per kg','essentials',30000,26000,'kg','sugar',48],
  ['Red lentils','Loose lentils - price per kg','essentials',35000,29000,'kg','lentils',42],
  ['Wheat flour 1 kg','All-purpose flour - sealed pack','essentials',24000,19500,'pack','flour',36],
  ['Fresh milk 1 L','UHT whole milk - 1 litre carton','beverages',52000,44000,'pcs','milk',24],
  ['Ceylon tea 100 g','Black tea - 100 g pouch','beverages',28000,21000,'pack','tea',28],
  ['Drinking water 1 L','Still mineral water - 1 litre','beverages',13000,8500,'pcs','water',48],
  ['Orange drink 500 ml','Ready to drink - 500 ml bottle','beverages',22000,16000,'pcs','soda',30],
  ['Cream biscuits','Family pack - 200 g','snacks',18000,13000,'pack','biscuits',40],
  ['Potato chips','Salted chips - 60 g','snacks',16000,11000,'pack','chips',4],
  ['Laundry soap','Multipurpose laundry bar','household',13000,9000,'pcs','soap',32],
  ['Washing powder 500 g','Laundry detergent - 500 g','household',42000,34000,'pack','detergent',20],
  ['Facial tissues','Soft tissue box - 100 sheets','household',25000,18000,'pcs','tissue',18],
  ['Toothpaste 120 g','Fluoride toothpaste - 120 g','personal-care',29000,21500,'pcs','toothpaste',16],
  ['Shampoo 180 ml','Daily care shampoo - 180 ml','personal-care',48000,37000,'pcs','shampoo',14],
  ['Potatoes','Fresh produce - price per kg','fresh-produce',28000,21000,'kg','potato',35],
  ['Red onions','Fresh produce - price per kg','fresh-produce',32000,25000,'kg','onion',28],
  ['Farm eggs','Medium eggs - price per egg','fresh-produce',4500,3500,'pcs','eggs',120],
] as const;
const demoMenu = (): MenuItem[] => sampleProducts.map((row,index)=>({
  id:`m${index+1}`,name:row[0],nameSi:row[0],description:row[1],categoryId:row[2],
  price:row[3],wholesalePrice:Math.round(row[3]*.94),cost:row[4],saleUnit:row[5],image:`/images/grocery/${row[6]}.jpg`,
  barcode:`479000000${String(index+1).padStart(4,'0')}`,sku:`MART-${String(index+1).padStart(4,'0')}`,
  available:true,stockMode:'prepared',reorderLevel:5,preparationMinutes:0,
  ...(index===0?{badge:'Essential'}:index===8?{badge:'Popular'}:{}),
}));

export async function initializeLocalWorkspace(input: InitializeLocalWorkspaceInput, db: LocalDatabase = localDb): Promise<{user: User; workspace: LocalWorkspaceInfo}> {
  try {
  const existing = await getLocalWorkspaceInfo(db);
  if (existing) return {user: await loginLocal(input.pin, undefined, db), workspace: existing};
  const businessName = input.businessName?.trim();
  const ownerName = input.ownerName?.trim();
  const demo = input.demo === true;
  requireLocal(typeof businessName === 'string' && businessName.length >= 2 && businessName.length <= 100, 'Enter a business name containing 2 to 100 characters.');
  requireLocal(typeof ownerName === 'string' && ownerName.length >= 2 && ownerName.length <= 100, 'Enter an owner name containing 2 to 100 characters.');
  requireLocal(typeof input.pin === 'string' && (demo ? /^\d{4,12}$/ : /^\d{6,12}$/).test(input.pin), demo ? 'Use a demo PIN containing 4 to 12 digits.' : 'Choose a private owner PIN containing 6 to 12 digits.');
  const createdAt = now();
  const workspace: LocalWorkspaceInfo = {version: 1, workspaceId: uid('workspace'), deviceId: uid('device'), businessName, demo, createdAt};
  const owner: StaffMember = {id:'staff-owner',name:ownerName,role:'owner',branchId:null,initials:ownerName.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase(),active:true,phone:'',lastActive:createdAt};
  const credential = await createLocalCredential(owner.id, input.pin);
  const authenticated = await prepareLocalSession(owner.id);
  await db.transaction('rw', db.tables, async () => {
    requireLocal(!await getLocalWorkspaceInfo(db), 'This device was just set up in another tab. Sign in to continue.', 409, 'ALREADY_INITIALIZED');
    requireLocal(await db.records.count() === 0 && await db.credentials.count() === 0, 'This device contains workspace data without a valid setup marker. Restore a verified backup before continuing.', 409, 'WORKSPACE_RECOVERY_REQUIRED');
    const store = new LocalStore(db);
    const branch: Branch = demo?{id:'b1',name:'Colombo',nameSi:'Colombo',code:'CMB',address:'',phone:''}:{...chickenBranch};
    await store.put('branch', branch);
    await store.put('staff', owner);
    for (const category of categories) await store.put('category', category);
    const settings: Settings = {businessName,tagline:'Your everyday store',currency:'LKR',taxRate:0,serviceChargeRate:0,receiptFooter:'Thank you for shopping with us. See you again!',lowStockAlerts:true,autoPrint:false,language:'en',...localReceiptDefaults};
    await store.setMeta('settings', settings);
    await store.setMeta('deviceId', workspace.deviceId);
    await store.setMeta('activeBranchId', branch.id);
    await store.setMeta('journalSequence', 0);
    await store.setMeta('storageFormat', 1);
    if (demo) {
      for (const [index,item] of demoMenu().entries()) {
        await store.put('menu', item);
        if (item.stockMode === 'prepared') await store.put<InventoryItem>('inventory', {id:`b1-prepared-${item.id}`,branchId:'b1',name:item.name,nameSi:item.name,category:'resale',unit:item.saleUnit??'pcs',quantity:sampleProducts[index][7],minimum:5,unitCost:item.cost,supplierId:null,menuItemId:item.id,updatedAt:createdAt});
      }
      await store.put('supplier', {id:'supplier-demo',name:'Sample wholesaler',phone:'0700000001',email:'',balance:0});
      await store.put('customer', {id:'c1',name:'Sample customer',phone:'',email:'',visits:0,spent:0,balance:0,points:0,createdAt});
      await store.put<Shift>('shift', {id:'b1-shift-demo',branchId:'b1',openedBy:owner.id,openedAt:createdAt,openingFloat:0,status:'open',closedAt:null,countedCash:null,expectedCash:0,variance:null});
    }
    await db.credentials.put(credential);
    await db.sessions.put(authenticated.session);
    // This marker commits with every record and credential. A failed or full
    // database must never leave a misleading "setup complete" flag behind.
    await store.setMeta('workspace', workspace);
  });
  rememberLocalSession(db, authenticated.sessionToken);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('local-workspace-change'));
  return {user: publicLocalUser(owner), workspace};
  } catch (error) {throw localStorageError(error);}
}
