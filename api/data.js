import {commitToFirebase,pathParts} from '../lib/cloud-commit.mjs';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.status(204).end();return;}
  if(!['GET','PUT','PATCH','DELETE'].includes(req.method)){res.status(405).json({error:'Unsupported request method.'});return;}
  const path=req.query?.path||'';
  try{
    if(typeof path!=='string')throw new Error('Invalid database path');
    if(path)pathParts(path);
    const base=(process.env.FIREBASE_DATABASE_URL||'https://chicken-shop-2d7b5-default-rtdb.firebaseio.com').replace(/\/+$/,'');
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(req.method==='PATCH'&&!path&&body?.__posCommand){res.status(200).json(await commitToFirebase(base,body.__posCommand));return;}
    const options={method:req.method,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)};
    if(['PUT','PATCH'].includes(req.method))options.body=JSON.stringify(body??null);
    const response=await fetch(`${base}/${path}.json`,options);
    res.status(response.status).json(await response.json());
  }catch(error){res.status(error.status||400).json({error:error.message||'The database request could not be completed.',code:error.code||'CLOUD_REQUEST_FAILED'});}
}