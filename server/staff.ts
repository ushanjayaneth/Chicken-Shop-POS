import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Store,ApiError,requireThat} from './database';
import {handleStaff} from '../src/lib/local/staff';
import type {LocalStore} from '../src/lib/local/db';
import type {User} from '../shared/types';

/** Stage async validation outside SQLite, then commit all effects synchronously
 * under a transaction after verifying that its input records did not change. */
export function registerStaffRoutes(app:FastifyInstance,store:Store,getUser:(request:FastifyRequest)=>User,scoped:(user:User,branchId:string)=>string){
 app.route({method:['POST','PATCH'],url:'/api/hr/*',handler:async request=>{
  const user=getUser(request),body=request.body as Record<string,unknown>;
  requireThat(body&&typeof body==='object'&&typeof body.commandId==='string'&&body.commandId.length>=8&&typeof body.branchId==='string','A command ID and branch are required.');
  const branchId=scoped(user,body.branchId),path=request.url.split('?')[0].replace(/^\/api/,''),action=`${request.method}:${path}`;
  const previous=store.db.prepare('SELECT id FROM commands WHERE id=?').get(body.commandId);
  if(previous)return store.command(body.commandId,user.id,action,branchId,body,()=>{throw new Error('Unreachable command replay');});
  const rows=()=>store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all() as {kind:string;id:string;data:string}[];
  const baseline=rows(),fingerprint=JSON.stringify(baseline),records=new Map(baseline.map(row=>[`${row.kind}:${row.id}`,JSON.parse(row.data)]));
  const changes=new Map<string,{kind:string;value:any}>();
  const buffered={
   async get<T>(kind:string,id:string){return structuredClone(records.get(`${kind}:${id}`)) as T|undefined;},
   async list<T>(kind:string,branch?:string){return [...records.entries()].filter(([key,row])=>key.startsWith(`${kind}:`)&&(branch===undefined||row.branchId===branch)).map(([,row])=>structuredClone(row)) as T[];},
   async put(kind:string,value:any){records.set(`${kind}:${value.id}`,structuredClone(value));changes.set(`${kind}:${value.id}`,{kind,value:structuredClone(value)});return value;},
   async meta(key:string){const value=store.meta(key);if(value===undefined)return undefined;try{return JSON.parse(value);}catch{return value;}},
  };
  try{
   const result=await handleStaff({path,method:request.method,query:new URLSearchParams(),body,user,store:buffered as unknown as LocalStore});
   requireThat(result!==undefined,'Staff operation not found.',404);
   return store.command(body.commandId,user.id,action,branchId,body,()=>{requireThat(JSON.stringify(rows())===fingerprint,'Records changed during this action. Review and retry.',409,'STAFF_VERSION_CONFLICT');for(const change of changes.values())store.put(change.kind,change.value);return result;});
  }catch(error){const cause=error as {status?:number;message:string;code?:string};if(cause.status)throw new ApiError(cause.status,cause.message,cause.code);throw error;}
 }});
}
