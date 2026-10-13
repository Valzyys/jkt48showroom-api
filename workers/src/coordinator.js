import { runWithEnv } from './runtime/env.js';
import { getApp } from './worker.js';
import { synchronize } from './library/jkt48/scraper/sync.js';
import { publicSyncError } from './runtime/sync-errors.js';

export class Coordinator {
  constructor(ctx, env) { this.ctx=ctx; this.env=env; this.tail=Promise.resolve(); }
  async security({kind,key,windowMs=240000,limit=1}) {
    if (!['nonce','rate'].includes(kind) || typeof key!=='string' || key.length>1024) throw new Error('Invalid security operation');
    const storageKey=kind+':'+key;
    const now=Date.now();
    let record=await this.ctx.storage.get(storageKey);
    if (!record || record.expires<=now) record={count:0,expires:now+Math.max(1000,Math.min(windowMs,86400000))};
    record.count++;
    await this.ctx.storage.put(storageKey,record);
    if (await this.ctx.storage.getAlarm()===null) await this.ctx.storage.setAlarm(now+300000);
    return {allowed:record.count<=limit,retryAfter:Math.ceil((record.expires-now)/1000)};
  }
  fetch(request) {
    const action=async()=>runWithEnv({...this.env,LOCAL_COORDINATOR:this},this.ctx,async()=>{
      if(new URL(request.url).pathname==='/jkt48-sync') {
        try {const {dataset,force}=await request.json();return Response.json(await synchronize(dataset,this.ctx.storage,{force:force===true}));}
        catch(error){return Response.json(publicSyncError(error)||{message:'JKT48 synchronization failed'},{status:error.status||500,headers:error.retryAfter?{'Retry-After':String(error.retryAfter)}:{}});}
      }
      if (new URL(request.url).pathname==='/security') return Response.json(await this.security(await request.json()));
      return (await getApp()).fetch(request,this.env,this.ctx);
    });
    const result=this.tail.then(action,action);
    this.tail=result.then(()=>{},()=>{});
    return result;
  }
  async alarm() {
    const rows=await this.ctx.storage.list();
    const expired=[...rows].filter(([,row])=>row.expires<=Date.now()).map(([key])=>key);
    for(let i=0;i<expired.length;i+=128) await this.ctx.storage.delete(expired.slice(i,i+128));
    if(rows.size>expired.length) await this.ctx.storage.setAlarm(Date.now()+300000);
  }
}
