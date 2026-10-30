const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),util=require('node:util');
const {Store}=require('./store.cjs');
function safeEqual(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function redact(value){let text=typeof value==='string'?value:util.inspect(value,{depth:3});for(const [k,v]of Object.entries(process.env))if(/TOKEN|SECRET|API_KEY|PASSWORD/i.test(k)&&v?.length>=8)text=text.split(v).join('[REDACTED]');return text.replace(/\b(Bot|Bearer)\s+[^\s,;"']+/gi,'$1 [REDACTED]').replace(/jkc_[a-zA-Z0-9_]+/g,'[REDACTED]').replace(/([?&](?:apikey|token|api_key)=)[^\s&"']+/gi,'$1[REDACTED]').slice(0,8000)}
for(const method of ['log','info','warn','error']){const original=console[method].bind(console);console[method]=(...args)=>original(...args.map(redact))}
function monitor(client,kind,store=new Store(process.env.BOT_DATA_DIR)){
 const state={kind,polls:{},connected:false,started_at:Date.now(),last_error:null};let closing=false;
 function flush(){const value={...state,updated_at:Date.now(),connected:client.isReady(),user:client.user?{id:client.user.id,name:client.user.tag}:null,guilds:client.guilds.cache.size,users:client.guilds.cache.reduce((s,g)=>s+(g.memberCount||0),0),gateway_ping_ms:client.ws.ping,uptime_seconds:Math.floor(process.uptime()),delivery_counts:store.counts(),servers:client.guilds.cache.map(g=>({id:g.id,name:g.name,icon:g.iconURL(),members:g.memberCount,owner_id:g.ownerId,owner_name:g.members.cache.get(g.ownerId)?.user?.tag||null,joined_at:g.members.me?.joinedTimestamp||null,...store.get('guild:'+g.id,{}),...(client.serverMetadata?.(g)||{})}))};const p=path.join(process.env.BOT_DATA_DIR,'state.json');fs.writeFileSync(p+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(p+'.tmp',p)}
 if(kind==='cavallery'){
  const post=client.rest.post.bind(client.rest);client.rest.post=async(route,options)=>{
   const match=/^\/channels\/(\d+)\/messages$/.exec(route);if(!match)return post(route,options);
   const event=crypto.randomUUID(),key='api:'+event+':'+match[1];store.enqueue('api',event,match[1],{content:redact(options?.body?.content||''),embeds:(options?.body?.embeds||[]).map(e=>({title:redact(e.title||''),description:redact(e.description||'')}))});store.update(key,{status:'sending'});
   try{const value=await post(route,options);store.update(key,{status:'sent',message_id:value.id,url:`https://discord.com/channels/${value.guild_id||client.channels.cache.get(match[1])?.guildId||'@me'}/${match[1]}/${value.id}`});console.log('message-sent channel='+match[1]+' id='+value.id);return value}
   catch(error){store.update(key,{status:error.status?'blocked':'uncertain',error:String(error.code||'send_failed')});throw error}
  };
 }
 client.on('error',error=>{state.last_error=String(error.code||error.name||'gateway_error');console.error('gateway-error',state.last_error)});
 client.on('shardDisconnect',(event,id)=>{state.last_error='gateway_disconnect_'+event.code;console.warn('gateway-disconnect shard='+id+' code='+event.code);flush()});
 client.on('shardReconnecting',id=>console.warn('gateway-reconnecting shard='+id));client.on('shardResume',id=>{state.last_error=null;console.log('gateway-resumed shard='+id)});
 client.once('clientReady',()=>{state.last_error=null;console.log('gateway-ready bot='+kind+' guilds='+client.guilds.cache.size);flush()});
 client.rest.on('rateLimited',info=>{state.rate_limit={at:Date.now(),retry_after_ms:info.timeToReset,global:info.global};console.warn('discord-rate-limit retry_ms='+info.timeToReset)});
 const timer=setInterval(flush,5000);timer.unref();
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{if(closing)return;closing=true;clearInterval(timer);state.stopped_at=Date.now();client.destroy();flush();process.exit(0)});
 flush();return {state,flush,store};
}
module.exports={monitor,redact,safeEqual};
