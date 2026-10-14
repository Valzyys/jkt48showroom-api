import { effectiveBindings } from './control/settings.js';
import { encode,decode } from 'cbor-x';
import { runWithEnv, env as runtimeEnv } from './runtime/env.js';

const groups=['jkt48','hinatazaka46'];
export class LiveHub {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; this.refreshPromise=null; }
  async lives() { return await this.ctx.storage.get('lives') || []; }
  send(socket,message) { try { socket.send(encode(typeof message==='string'?message:JSON.stringify(message))); } catch {} }
  count() {
    const paths={}, sockets=this.ctx.getWebSockets(); let admins=0;
    for(const socket of sockets) { const info=socket.deserializeAttachment(); const path=info?.path||'/'; paths[path]=(paths[path]||0)+1; if(info?.admin) admins++; }
    return {type:'user-count',data:{paths,user_count:sockets.length,admin_count:admins}};
  }
  publishCount() { for(const socket of this.ctx.getWebSockets()) if(socket.deserializeAttachment()?.admin) this.send(socket,{type:'admin',data:this.count()}); }
  async broadcast() {
    const lives=await this.lives();
    for(const socket of this.ctx.getWebSockets()) for(const group of socket.deserializeAttachment()?.groups||[]) this.send(socket,{type:group,data:lives.filter(live=>live.group===group)});
  }
  async update(lives,group) {
    const { CombinedLivesListZod }=await import('./library/combinedNowLive.js');
    lives=CombinedLivesListZod.parse(lives);
    if(group && !groups.includes(group)) throw new Error('Invalid group');
    const previous=await this.lives();
    const next=group?[...previous.filter(live=>live.group!==group),...lives.filter(live=>live.group===group)]:lives;
    await this.ctx.storage.put({lives:next,updatedAt:Date.now(),revision:(await this.ctx.storage.get('revision')||0)+1});
    await this.ctx.storage.setAlarm(Date.now()+Number(runtimeEnv.LIVE_REFRESH_SECONDS||this.env.LIVE_REFRESH_SECONDS||300)*1000);
    await this.broadcast();
  }
  async refresh() {
    if(this.refreshPromise) return this.refreshPromise;
    this.refreshPromise=(async()=>{
      const { fetchCombined }=await import('./library/combinedNowLive.js');
      const revision=await this.ctx.storage.get('revision')||0;
      const previous=await this.lives();
      const results=await Promise.allSettled(groups.map(group=>fetchCombined(group,false)));
      const lives=results.flatMap((result,i)=>result.status==='fulfilled'?result.value:previous.filter(live=>live.group===groups[i]));
      if((await this.ctx.storage.get('revision')||0)!==revision) return this.lives();
      await this.ctx.storage.put({lives,updatedAt:Date.now()});
      await this.broadcast();
      await this.ctx.storage.setAlarm(Date.now()+Number(runtimeEnv.LIVE_REFRESH_SECONDS||this.env.LIVE_REFRESH_SECONDS||300)*1000);
      return lives;
    })().finally(()=>{this.refreshPromise=null;});
    return this.refreshPromise;
  }
  async fetch(request) {
    return runWithEnv(await effectiveBindings(this.env),this.ctx,async()=>{
      const path=new URL(request.url).pathname;
      if(path==='/lives') { if(await this.ctx.storage.get('updatedAt')==null) await this.refresh(); return Response.json(await this.lives()); }
      if(path==='/update' && request.method==='POST') { const data=await request.json(); await this.update(data.lives,data.group); return Response.json({ok:true}); }
      if(path==='/refresh' && request.method==='POST') { await this.refresh(); return Response.json({ok:true}); }
      if(path==='/ws' && request.headers.get('Upgrade')?.toLowerCase()==='websocket') {
        const { isJWTValid }=await import('./utils/security/jwt.js');
        if(!isJWTValid(new URL(request.url).searchParams.get('token'))) return Response.json({status:401,message:'Unauthorized!'}, {status:401});
        const pair=new WebSocketPair(), [client,server]=Object.values(pair);
        server.serializeAttachment({id:crypto.randomUUID(),path:'/',groups:[],admin:false});
        this.ctx.acceptWebSocket(server);
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING','PONG'));
        this.publishCount();
        return new Response(null,{status:101,webSocket:client});
      }
      return new Response('Not found',{status:404});
    });
  }
  async webSocketMessage(socket,raw) {
    return runWithEnv(await effectiveBindings(this.env),this.ctx,async()=>{
      try {
        if(typeof raw==='string' || raw.byteLength>65536) { socket.close(1003,'Expected CBOR'); return; }
        const message=decode(new Uint8Array(raw));
        if(typeof message!=='string') { socket.close(1003,'Expected string'); return; }
        const info=socket.deserializeAttachment();
        if(message.startsWith('PING')) this.send(socket,'PONG');
        else if(message.startsWith('listen ')) {
          const lives=await this.lives();
          for(const group of message.split(' ').slice(1)) if(groups.includes(group)) {
            info.groups=[...new Set([...info.groups,group])];
            this.send(socket,{type:group,data:lives.filter(live=>live.group===group)});
            this.send(socket,'ok-listen');
          }
          socket.serializeAttachment(info);
        } else if(message.startsWith('view ')) { info.path=message.slice(5,261); socket.serializeAttachment(info); this.publishCount(); }
        else if(message.startsWith('admin ')) {
          const { verifyJWT }=await import('./utils/security/jwt.js');
          if(verifyJWT(message.slice(6)).admin===true) { info.admin=true; socket.serializeAttachment(info); this.send(socket,{type:'admin',data:this.count()}); }
        }
      } catch { this.send(socket,'error'); }
    });
  }
  webSocketClose(socket,code) { socket.close(code); this.publishCount(); }
  webSocketError(socket) { socket.close(1011,'Connection error'); this.publishCount(); }
  async alarm() { return runWithEnv(await effectiveBindings(this.env),this.ctx,async()=>{ try { await this.refresh(); } finally { await this.ctx.storage.setAlarm(Date.now()+Number(runtimeEnv.LIVE_REFRESH_SECONDS||this.env.LIVE_REFRESH_SECONDS||300)*1000); } }); }
}
