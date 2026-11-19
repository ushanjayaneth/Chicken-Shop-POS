import type {Branch, Category, MenuItem, StaffMember, InventoryItem, Settings, Supplier, Customer, Shift} from '../shared/types';
import {Store, now} from './database';
import {setPin} from './security';
import {receiptDefaults} from './business';

/** Independent retail hub seed. Real shops begin with an empty catalog. */
export function initialize(store:Store,demo:boolean){
  if(store.meta('initialized'))return;
  if(!demo&&!/^\d{6,12}$/.test(process.env.INITIAL_ADMIN_PIN??''))throw new Error('Set INITIAL_ADMIN_PIN to a private 6-12 digit PIN before starting with POS_DEMO_MODE=false.');
  store.transaction(()=>{
    const branch:Branch={id:'b1',name:'Main store',nameSi:'Main store',code:'MAIN',address:'',phone:''};
    store.put('branch',branch);
    const settings:Settings={businessName:demo?'DEMO MART':'My Store',tagline:'Grocery & everyday essentials',currency:'LKR',taxRate:0,serviceChargeRate:0,receiptFooter:'Thank you for shopping with us.',lowStockAlerts:true,autoPrint:false,language:'en',...receiptDefaults};
    store.setMeta('settings',JSON.stringify(settings));
    const categories:Category[]=[
      {id:'staples',name:'Rice & grains',nameSi:'Rice & grains',icon:'rice'},
      {id:'pantry',name:'Pantry essentials',nameSi:'Pantry essentials',icon:'package'},
      {id:'fresh',name:'Fresh & dairy',nameSi:'Fresh & dairy',icon:'leaf'},
      {id:'drinks',name:'Beverages',nameSi:'Beverages',icon:'cup'},
      {id:'snacks',name:'Snacks & bakery',nameSi:'Snacks & bakery',icon:'croissant'},
      {id:'household',name:'Household & care',nameSi:'Household & care',icon:'package'},
    ];
    for(const category of categories)store.put('category',category);
    const owner:StaffMember={id:'staff-owner',name:demo?'Demo Owner':'Administrator',role:'owner',branchId:null,initials:'OW',active:true,phone:'',lastActive:null};
    store.put('staff',owner);setPin(store,owner.id,demo?'1234':process.env.INITIAL_ADMIN_PIN!);
    if(demo){
      const team=[{id:'staff-cashier',name:'Demo Cashier',role:'cashier',pin:'2222',initials:'CA'},{id:'staff-manager',name:'Demo Manager',role:'manager',pin:'6666',initials:'MA'},{id:'staff-storekeeper',name:'Demo Storekeeper',role:'storekeeper',pin:'5555',initials:'ST'}] as const;
      for(const member of team){store.put<StaffMember>('staff',{id:member.id,name:member.name,role:member.role,branchId:branch.id,initials:member.initials,active:true,phone:'',lastActive:null});setPin(store,member.id,member.pin);}
      const suppliers:Supplier[]=[{id:'s1',name:'Sample Grocery Wholesaler',phone:'0700000001',email:'orders@grocery.example',balance:0},{id:'s2',name:'Sample Fresh Foods',phone:'0700000002',email:'orders@fresh.example',balance:0}];
      for(const supplier of suppliers)store.put('supplier',supplier);
      const goods:[string,string,string,number,number,string,number][]=[
        ['m1','Samba rice','staples',26000,22000,'kg',85],
        ['m2','White sugar','pantry',27500,24000,'kg',3],
        ['m3','Red dhal','staples',35000,28000,'kg',38],
        ['m4','Wheat flour','staples',21000,18000,'kg',60],
        ['m5','Table salt 1 kg','pantry',16000,13000,'packs',24],
        ['m6','Coconut oil 1 L','pantry',76000,65000,'bottles',12],
        ['m7','Fresh milk 1 L','fresh',48000,42000,'packs',22],
        ['m8','Ceylon tea 100 g','drinks',24000,20000,'packs',40],
        ['m9','Farm eggs','fresh',5000,4200,'pcs',80],
        ['m10','Bread loaf','snacks',14000,11000,'pcs',18],
        ['m11','Cream crackers','snacks',18000,14500,'packs',36],
        ['m12','Bath soap','household',15000,12000,'pcs',32],
        ['m13','Shampoo 180 ml','household',49000,41500,'bottles',20],
        ['m14','Drinking water 1 L','drinks',13000,10000,'bottles',20],
        ['m15','Red onions','fresh',30000,23000,'kg',32],
        ['m16','Potatoes','fresh',34000,26000,'kg',42],
      ];
      for(const [id,name,categoryId,price,cost,unit,quantity] of goods){
        const item:MenuItem={id,name,nameSi:name,description:unit==='kg'?'Loose goods - price per kilogram.':'Everyday grocery essentials.',categoryId,price,wholesalePrice:Math.round(price*.94),cost,image:'/images/grocery/default.jpg',saleUnit:unit==='packs'?'pack':unit==='bottles'?'pcs':unit,available:true,stockMode:'prepared',preparationMinutes:0,sku:'DEMO-'+id.toUpperCase(),barcode:'990000'+id.slice(1).padStart(6,'0'),reorderLevel:5};
        store.put('menu',item);
        store.put<InventoryItem>('inventory',{id:branch.id+'-retail-'+id,branchId:branch.id,name,nameSi:name,category:'resale',unit:item.saleUnit!,quantity,minimum:5,unitCost:cost,supplierId:categoryId==='fresh'?'s2':'s1',menuItemId:id,updatedAt:now()});
      }
      store.put<Customer>('customer',{id:'c1',name:'Sample Customer',phone:'0700000010',email:'',visits:0,spent:0,balance:0,points:0,createdAt:now()});
      store.put<Shift>('shift',{id:'b1-shift-demo',branchId:'b1',openedBy:owner.id,openedAt:now(),openingFloat:0,status:'open',closedAt:null,countedCash:null,expectedCash:0,variance:null});
      store.put('audit',{id:'b1-retail-demo',branchId:'b1',action:'demo.initialized',actor:'System',detail:'Sample retail catalog and opening stock. No historical sales are fabricated. Create a fresh workspace for real trading.',createdAt:now()});
    }
    store.setMeta('demo',String(demo));store.setMeta('initialized',now());
  });
}
