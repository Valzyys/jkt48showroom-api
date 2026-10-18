const {randomUUID}=require('node:crypto');
const {parseFrames}=require('./idn-events.cjs');
const {request}=require('./live-notification-http.cjs');

// IDN's public web chat uses IRC over WebSocket. Loading the entire website is
// unnecessary, and a working page is not proof that its chat actually joined.
function ircLine(raw){
 if(typeof raw!=='string'||raw.length>1000000)return null;
 let rest=raw.trim(),tags={};
 if(rest.startsWith('@')){
  const end=rest.indexOf(' ');if(end<0)return null;
  for(const tag of rest.slice(1,end).split(';')){const [key,...value]=tag.split('=');tags[key]=value.join('=')}
  rest=rest.slice(end+1).trimStart();
 }
 let prefix='';
 if(rest.startsWith(':')){const end=rest.indexOf(' ');if(end<0)return null;prefix=rest.slice(1,end);rest=rest.slice(end+1).trimStart()}
 const trailing=rest.indexOf(' :'),parts=(trailing<0?rest:rest.slice(0,trailing)).split(/ +/);
 if(trailing>=0)parts.push(rest.slice(trailing+2));
 return {command:parts.shift()?.toUpperCase(),params:parts,prefix,tags};
}
function roomUrl(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='www.idn.app'&&!u.search&&!u.hash&&/^\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*\/live\/[a-zA-Z0-9_-]+$/.test(u.pathname))return u}catch{}
 return null;
}
class IdnChatObserver{
 constructor({emit,fetcher=request,WebSocket=require('ws'),clientKey=process.env.IDN_WEB_CLIENT_KEY,now=Date.now}){
  Object.assign(this,{emit,fetcher,WebSocket,clientKey,now});this.pages=new Map();this.auth={};this.maxPages=16;
 }
 error(entry,code){if(!entry.closing){entry.connected=false;entry.error=code;this.emit({id:entry.id,kind:'error',code})}}
 current(entry,generation){return !entry.closing&&this.pages.get(entry.id)===entry&&entry.generation===generation}
 send(entry,line){if(entry.socket?.readyState===1)entry.socket.send(line)}
 channel(data,entry){
  if(!data||typeof data!=='object')throw Error('chat_metadata_invalid');
  if(data.live_type==='idnliveplus'||data.is_hidden)throw Error('chat_room_restricted');
  if(data.slug&&data.slug!==entry.slug)throw Error('chat_room_mismatch');
  const channel=String(data.chat_room_id||'').replace(/^#/,'');
  // IDN uses both short channel names and the original IVS room ARN over IRC.
  if(!/^(?:[a-zA-Z0-9_-]{1,200}|arn:aws:ivschat:[a-z0-9-]{1,40}:\d{12}:room\/[a-zA-Z0-9_-]{1,100})$/.test(channel))throw Error('chat_room_unavailable');
  return '#'+channel;
 }
 async metadata(entry){
  if(!this.clientKey)throw Error('chat_config_missing');
  const headers={'x-api-key':this.clientKey,Origin:'https://www.idn.app',Referer:'https://www.idn.app/'};
  if(this.auth.ready){headers['access-token']=this.auth.accessToken;headers.Authorization='Bearer '+this.auth.idToken}
  for(const version of [5,4]){
   const response=await this.fetcher('https://api.idn.app/api/v'+version+'/livestream/'+encodeURIComponent(entry.slug),{headers,signal:AbortSignal.timeout(15000)});
   if(response.status===404)continue;
   if(!response.ok)throw Error('chat_metadata_http_'+response.status);
   return this.channel((await response.json()).data,entry);
  }
  // The public page can retain valid room metadata when the detail API is 404.
  // Read only its matching server-rendered livestream; never guess a channel.
  let response;
  for(let attempt=0;attempt<2;attempt++){response=await this.fetcher(entry.url,{signal:AbortSignal.timeout(15000)});if(response.status<500)break}
  if(!response.ok)throw Error('chat_page_http_'+response.status);
  const html=await response.text();if(html.length>3000000)throw Error('chat_page_invalid');
  const match=/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if(!match)throw Error('chat_page_invalid');
  let props;try{props=JSON.parse(match[1]).props?.pageProps}catch{throw Error('chat_page_invalid')}
  const data=props?.livestream;
  if(data?.slug!==entry.slug)throw Error('chat_room_mismatch');
  if(data?.creator?.username&&data.creator.username!==new URL(entry.url).pathname.split('/')[1])throw Error('chat_room_mismatch');
  return this.channel(data,entry);
 }
 announce(entry){
  // Match the web client's viewer registration. Do not publish comments/gifts.
  this.send(entry,'PRIVMSG IDNHeimdall :JOINED '+JSON.stringify({room_identifier:entry.channel.slice(1),user_identifier:entry.viewerId,extra_user_identifier:entry.viewerId,join_at:entry.joinedAt,created_at:entry.joinedAt,is_login:false}));
 }
 frame(entry,generation,raw){
  if(!this.current(entry,generation))return;
  entry.lastActivity=this.now();
  for(const text of String(raw).split(/\r?\n/)){
   const message=ircLine(text);if(!message)continue;
   const {command,params,prefix}=message;
   if(command==='PING'){this.send(entry,'PONG :'+params.at(-1));continue}
   if(command==='CAP'&&params[1]==='LS'){
    entry.capabilities.push(...params.at(-1).split(' '));if(params[2]==='*')continue;
    const available=entry.capabilities,wanted=['message-tags','server-time','batch'].filter(c=>available.includes(c));
    entry.history=available.includes('draft/chathistory')||available.includes('chathistory');
    if(entry.history)wanted.push(available.includes('chathistory')?'chathistory':'draft/chathistory');
    if(wanted.length)this.send(entry,'CAP REQ :'+wanted.join(' '));else this.send(entry,'CAP END');
   }else if(command==='CAP'&&['ACK','NAK'].includes(params[1]))this.send(entry,'CAP END');
   else if(command==='001'){this.send(entry,'JOIN '+entry.channel);this.announce(entry)}
   else if((command==='JOIN'&&prefix.split('!')[0]===entry.nick&&params[0]===entry.channel)||(command==='366'&&params[1]===entry.channel)){
    if(!entry.connected){
     entry.connected=true;entry.failures=0;entry.error=null;this.emit({id:entry.id,kind:'connected'});
     // Only ask for history when this server advertises it; preserve provider
     // message IDs so the collector's durable journal can discard replays.
     const since=entry.cursor?.time;
     if(entry.history&&since&&!Number.isNaN(Date.parse(since)))this.send(entry,'CHATHISTORY AFTER '+entry.channel+' timestamp='+new Date(since).toISOString()+' 100');
    }
   }else if(['403','405','471','473','474','475','477','489'].includes(command)&&params.includes(entry.channel)){
    this.error(entry,'chat_join_rejected');entry.socket.close();
   }else if(['464','465'].includes(command)||command==='ERROR'){
    this.error(entry,'chat_registration_rejected');entry.socket.close();
   }
   if(command!=='PRIVMSG')continue;
   const channelMessage=params[0]===entry.channel;
   // Gold/gift events are also sent privately by IDNOdin to the viewer nick.
   // Binding BOTH sender and payload room prevents mixing simultaneous lives.
   const directMessage=params[0]===entry.nick&&prefix.split('!')[0]==='IDNOdin';
   if(!channelMessage&&!directMessage)continue;
   for(const event of parseFrames(text)){
    if(!['gift','comment','user'].includes(event.kind))continue;
    // The IRC channel binds the room. Some messages use a channel UUID as
    // room_id, others use the public live slug.
    if(directMessage&&event.room_id!==entry.slug)continue;
    if(event.room_id&&![entry.slug,entry.channel.slice(1)].includes(event.room_id))continue;
    const id=event.event_id||generation+':'+(++entry.sequence);
    const when=event.event_time||message.tags.time;
    if(when&&(!entry.cursor?.time||Date.parse(when)>=Date.parse(entry.cursor.time)))entry.cursor={id,time:when};
    this.emit({id:entry.id,...event,event_id:id,...(when?{event_time:when}:{})});
   }
  }
 }
 async open(entry){
  if(entry.creating||entry.closing)return;
  entry.creating=true;entry.connected=false;const generation=++entry.generation;
  try{
   const channel=await this.metadata(entry);if(!this.current(entry,generation))return;
   entry.channel=channel;entry.viewerId=randomUUID();entry.joinedAt=Math.floor(this.now()/1000);entry.nick='idn-'+entry.viewerId+'-web';entry.sequence=0;entry.capabilities=[];
   const socket=new this.WebSocket('wss://chat.idn.app',{origin:'https://www.idn.app',handshakeTimeout:12000,maxPayload:1000000});
   entry.socket=socket;entry.lastActivity=this.now();entry.lastPing=this.now();
   socket.on('open',()=>{
    if(!this.current(entry,generation))return;
    // WebSocket IRC sends ONE command per frame, without a CRLF batch.
    for(const line of ['CAP LS 302','NICK '+entry.nick,'USER '+entry.nick+' 0 * :IDN web viewer'])this.send(entry,line);
   });
   socket.on('message',raw=>this.frame(entry,generation,raw.toString()));
   socket.on('error',()=>{if(this.current(entry,generation))this.error(entry,'chat_socket_error')});
   socket.on('close',()=>{
    if(!this.current(entry,generation))return;
    entry.socket=null;entry.failures++;entry.lastAttempt=this.now();this.error(entry,entry.error||'chat_disconnected');
   });
  }catch(error){
   if(this.current(entry,generation)){entry.failures++;this.error(entry,/^chat_[a-z0-9_]+$/.test(error.message)?error.message:'chat_metadata_unavailable')}
  }finally{if(this.current(entry,generation)){entry.creating=false;entry.lastAttempt=this.now()}}
 }
 async recover(entry){
  if(entry.closing||entry.creating)return;
  if(entry.socket){
   const age=this.now()-entry.lastActivity;
   if(age>90000||!entry.connected&&age>30000){this.error(entry,'chat_stalled');entry.socket.terminate();return}
   if(this.now()-entry.lastPing>=25000){entry.lastPing=this.now();this.send(entry,'PING :idn-observer-'+this.now())}
   return;
  }
  if(this.now()-entry.lastAttempt<Math.min(30000,2000*2**Math.min(entry.failures,4)))return;
  await this.open(entry);
 }
 async message(value){
  if(value.action==='auth'){this.auth=value.value||{};return}
  if(value.action==='limits'){this.maxPages=Math.max(1,Math.min(16,Number(value.value)||16));return}
  if(value.action==='remove'){
   const entry=this.pages.get(value.id);if(entry){entry.closing=true;this.pages.delete(value.id);entry.socket?.terminate()}return;
  }
  if(value.action!=='add')return;
  const url=roomUrl(value.url);if(!url)return;
  const old=this.pages.get(value.id);if(old){await this.recover(old);return}
  if(this.pages.size>=this.maxPages){this.emit({id:value.id,kind:'error',code:'chat_capacity'});return}
  const entry={id:value.id,url:url.href,slug:url.pathname.split('/').pop(),generation:0,failures:0,lastAttempt:0,cursor:value.cursor};
  this.pages.set(entry.id,entry);await this.open(entry);
 }
 tick(){for(const entry of this.pages.values())this.recover(entry).catch(()=>{})}
 async stop(){for(const entry of this.pages.values()){entry.closing=true;entry.socket?.terminate()}this.pages.clear()}
}
module.exports={IdnChatObserver,ircLine};
