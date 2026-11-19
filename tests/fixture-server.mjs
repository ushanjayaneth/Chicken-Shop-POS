import {applyCloudCommit} from '../lib/cloud-commit.mjs';
import {createPOSServer} from '../scripts/server.mjs';
import {pathToFileURL} from 'node:url';
export function createFixtureServer() {
  const state={
    settings:{main:{shopName:'Mr. Chicken House',adminPin:'1234',currency:'Rs.',lowStockAlert:5,receiptNote:'Thank you for shopping with us.',openingFloats:{},coconutOpeningFloats:{}}},
    categories:{chicken:{name:'Fresh Chicken'},fish:{name:'Fish & Seafood'},eggs:{name:'Eggs & Essentials'}},
    items:{
      chicken:{name:'Fresh whole chicken',type:'weighted',unit:'kg',price:1200,costPrice:900,categoryId:'chicken',barcode:'111001',stockBatches:[{batchId:'ch1',quantity:15,costPrice:900,dateAdded:'2026-11-14'}]},
      breast:{name:'Chicken breast',type:'weighted',unit:'kg',price:1800,costPrice:1350,categoryId:'chicken',barcode:'111002',stockBatches:[{batchId:'br1',quantity:8,costPrice:1350,dateAdded:'2026-11-14'}]},
      fish:{name:'Fresh tuna',type:'weighted',unit:'kg',price:2200,costPrice:1600,categoryId:'fish',barcode:'111003',stockBatches:[{batchId:'fi1',quantity:12,costPrice:1600,dateAdded:'2026-11-14'}]},
      eggs:{name:'Farm eggs',type:'unit',unit:'pcs',price:45,costPrice:35,categoryId:'eggs',barcode:'111004',stockBatches:[{batchId:'eg1',quantity:60,costPrice:35,dateAdded:'2026-11-14'}]}
    },sales:{},loans:{},loan_customers:{},coconut_purchases:{},coconut_husking:{},coconut_gradings:{},coconut_sales:{},coconut_copra:{},coconut_oil:{},coconut_workers:{},coconut_worker_payments:{},cash_movements:{},day_ends:{}
  };
  function read(path){return path?path.split('/').reduce((value,key)=>value?.[key],state)??null:structuredClone(state);}
  function set(path,value){const keys=path.split('/').filter(Boolean);let node=state;for(const key of keys.slice(0,-1)){node[key]??={};node=node[key];}if(value===null)delete node[keys.at(-1)];else node[keys.at(-1)]=structuredClone(value);}
  const requests=[];
  const server=createPOSServer({api:async(request,response)=>{
    const path=request.query.path;requests.push({method:request.method,path,body:request.body});
    if(request.method==='GET'){response.status(200).json(read(path));return;}
    if(request.method==='PATCH'&&request.body?.__posCommand){try{const next=applyCloudCommit(state,request.body.__posCommand).snapshot;Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,next);response.status(200).json({ok:true,id:request.body.__posCommand.id});}catch(error){response.status(error.status||400).json({error:error.message});}return;}
    if(request.method==='PATCH'){for(const[key,value]of Object.entries(request.body||{}))set([path,key].filter(Boolean).join('/'),value);}
    else if(request.method==='PUT')set(path,request.body);
    else if(request.method==='DELETE')set(path,null);
    else {response.status(405).json({error:'Unsupported method'});return;}
    response.status(200).json(request.body??null);
  }});
  return {server,state,requests};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const fixture=createFixtureServer();fixture.server.listen(4189,'127.0.0.1',()=>console.log('Isolated sample workspace http://127.0.0.1:4189/'));}